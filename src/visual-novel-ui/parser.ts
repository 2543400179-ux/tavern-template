import {
  BgWorldState,
  DialogueOption,
  DialogueSegment,
  ParsedScript,
  ResourceConfig,
  SegmentEffects,
  SkitLine,
  ThreatLevel,
} from './types';

/**
 * 清洗指令值中 Gemini 等模型可能插入的乱符号
 * 对 char、face、about 等名称类指令，去除不该出现的标点和符号
 * 对 desc 等自由文本类指令不做清洗
 */
// eslint-disable-next-line no-useless-escape
const NAME_JUNK_RE = /[-\-－·.…。，,、！!？?：:；;～~「」『』【】\[\]()（）《》<>""''"/\\|`#*_^]+/g;
const NAME_COMMAND_TYPES = new Set(['char', 'face', 'about', 'cg']);

function sanitizeCommandValue(type: string, value: string): string {
  if (!NAME_COMMAND_TYPES.has(type)) return value;
  // 去除名称中不该出现的标点/符号，保留中日韩文字、字母、数字、空格、{{}}宏
  return value.replace(NAME_JUNK_RE, '').trim();
}

/**
 * 从文本中提取 <ui>...</ui> 标签内的内容
 * 如果没有 <ui> 标签，返回空字符串（<ui> 外的内容不应被解析为对话段落）
 */
export function extractUIContent(text: string): string {
  const match = text.match(/<ui>([\s\S]*?)<\/ui>/);
  if (!match) return '';
  let content = match[1].trim();
  // 剥离 <skit>...</skit> 块，使其不参与 segments 解析
  content = content.replace(/<skit>[\s\S]*?<\/skit>/g, '');
  // 剥离 AI 可能误放在 <ui> 内的非对话标签（如 <UpdateVariable>、<Analysis> 等）
  content = content.replace(/<(?!ui)[A-Z][A-Za-z]*>[\s\S]*?<\/[A-Z][A-Za-z]*>/g, '');
  return content.trim();
}

/**
 * 从原始文本中提取 <skit>...</skit> 小剧场内容
 * 每行格式：[角色名]台词内容
 * 返回空数组表示没有小剧场
 */
export function extractSkit(rawText: string): SkitLine[] {
  const uiMatch = rawText.match(/<ui>([\s\S]*?)<\/ui>/);
  if (!uiMatch) return [];
  const content = uiMatch[1];
  const skitMatch = content.match(/<skit>([\s\S]*?)<\/skit>/);
  if (!skitMatch) return [];

  const lines = skitMatch[1]
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const skitLines: SkitLine[] = [];
  const lineRegex = /^\[(.+?)\](.+)$/;

  for (const line of lines) {
    const m = lineRegex.exec(line);
    if (m) {
      skitLines.push({ speaker: m[1].trim(), text: m[2].trim() });
    }
  }

  return skitLines;
}

/**
 * 从单个段落中提取所有指令并返回清理后的纯文本
 *
 * 支持的指令格式: [type:value]
 * - [bgm:xxx] - 切换背景音乐
 * - [bg:xxx]  - 切换背景图
 * - [char:xxx] - 切换说话人
 * - [face:xxx] - 切换立绘表情
 * - [ja:xxx] - 日语文本（用于 TTS）
 * - [zh:xxx] - 中文释义
 */
function extractCommands(paragraph: string): { 
  effects: SegmentEffects; 
  cleanText: string; 
  options: DialogueOption[];
  textJa?: string;
  textZh?: string;
} {
  const effects: SegmentEffects = {};
  const options: DialogueOption[] = [];
  let cleanText = paragraph;
  let textJa: string | undefined;
  let textZh: string | undefined;

  // 先提取双语标记 [ja:xxx][zh:xxx]
  const bilingualRegex = /\[ja:([^\]]+)\](?:\[zh:([^\]]+)\])?/g;
  let bilingualMatch: RegExpExecArray | null;
  const bilingualParts: Array<{ ja: string; zh?: string }> = [];
  
  while ((bilingualMatch = bilingualRegex.exec(paragraph)) !== null) {
    bilingualParts.push({
      ja: bilingualMatch[1].trim(),
      zh: bilingualMatch[2]?.trim(),
    });
  }

  // 如果有双语标记，组装 textJa 和 textZh
  if (bilingualParts.length > 0) {
    textJa = bilingualParts.map(p => p.ja).join('');
    textZh = bilingualParts.map(p => p.zh || '').filter(t => t).join('');
  }

  // 匹配所有 [type:value] 格式的指令（排除 ja 和 zh）
  const commandRegex = /\[(bgm|bg|char|face|about|desc|cg):([^\]]+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = commandRegex.exec(paragraph)) !== null) {
    const type = match[1] as 'bgm' | 'bg' | 'char' | 'face' | 'about' | 'desc' | 'cg';
    const value = sanitizeCommandValue(type, match[2].trim());

    // bg 指令支持四段式 [bg:场景记|威胁度|时间|资源key] 格式
    if (type === 'bg' && value.includes('|')) {
      const parts = value.split('|').map(s => s.trim());
      effects.bg = parts[0]; // 场景记（显示用大标题）
      if (parts[1]) effects.bgThreat = parts[1]; // 威胁等级
      if (parts[2]) effects.bgTime = parts[2]; // 时间
      if (parts[3]) effects.bgKey = parts[3]; // 资源库 key（用于查找背景图）
    } else {
      effects[type] = value;
    }
  }

  // 提取 [stat:] 指令（段落级状态覆写）
  // 支持两种语法：
  //   赋值：[stat:创伤=轻伤]  [stat:身份=拾荒者]
  //   增量：[stat:力量+1]  [stat:体力-2]  [stat:背包.罐头.数量+2]
  const statRegex = /\[stat:([^\]]+)\]/g;
  let statMatch: RegExpExecArray | null;
  while ((statMatch = statRegex.exec(paragraph)) !== null) {
    const raw = statMatch[1].trim();
    // 先尝试匹配增量语法：path+N 或 path-N
    const deltaMatch = raw.match(/^(.+?)([+-])(\d+(?:\.\d+)?)$/);
    if (deltaMatch) {
      const path = deltaMatch[1].trim();
      const sign = deltaMatch[2] === '+' ? 1 : -1;
      const value = sign * Number(deltaMatch[3]);
      if (!effects.stats) effects.stats = [];
      effects.stats.push({ path, value, mode: 'delta' });
    } else {
      // 赋值语法：path=value
      const eqIdx = raw.indexOf('=');
      if (eqIdx > 0) {
        const path = raw.slice(0, eqIdx).trim();
        const rawValue = raw.slice(eqIdx + 1).trim();
        // 自动推断类型：纯数字转 number，否则保留 string
        const numVal = Number(rawValue);
        const value: string | number = !isNaN(numVal) && rawValue.length > 0 ? numVal : rawValue;
        if (!effects.stats) effects.stats = [];
        effects.stats.push({ path, value, mode: 'set' });
      }
    }
  }

  // 提取收集指令 [收集:类型:标题｜描述] 或 [收集:类型:标题|描述] 或 [收集:类型:标题]
  const collectRegex = /\[收集:([^:：\]]+)[：:]([^\]]+)\]/g;
  let collectMatch: RegExpExecArray | null;
  while ((collectMatch = collectRegex.exec(paragraph)) !== null) {
    const type = collectMatch[1].trim();
    const rest = collectMatch[2].trim();
    // 分割标题和描述（支持中文｜和英文|）
    const sepIdx = rest.search(/[｜|]/);
    const title = sepIdx >= 0 ? rest.slice(0, sepIdx).trim() : rest;
    const desc = sepIdx >= 0 ? rest.slice(sepIdx + 1).trim() : '';
    if (!effects.collections) effects.collections = [];
    effects.collections.push({ type, title, desc });
  }

  // 提取选项指令 [option:A|B|C] — 管道分隔多个选项
  const optionRegex = /\[option:([^\]]+)\]/g;
  let optionMatch: RegExpExecArray | null;
  let optionIndex = 0;

  while ((optionMatch = optionRegex.exec(paragraph)) !== null) {
    const optionTexts = optionMatch[1]
      .split('|')
      .map(t => t.trim())
      .filter(t => t.length > 0);
    for (const text of optionTexts) {
      options.push({
        id: `opt_${optionIndex++}`,
        text,
      });
    }
  }

  // 移除所有指令标记（包括 option、about、cg、stat、收集、ja、zh）
  cleanText = cleanText.replace(/\[(bgm|bg|char|face|about|option|desc|cg|stat|收集|ja|zh):[^\]]+\]/g, '');

  // 清理多余空行和空白
  cleanText = cleanText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n')
    .trim();

  return { effects, cleanText, options, textJa, textZh };
}

/**
 * 将原始文本分割成段落
 * 以空行（连续两个换行）作为段落分隔符
 */

/**
 * 检测是否为内心独白
 * 规则：文本被圆括号（中文或英文）包裹，或包含 [inner] 标记
 */
function detectInnerMonologue(text: string): { isInner: boolean; cleanText: string } {
  // 检测 [inner] 标记
  if (text.includes('[inner]')) {
    return {
      isInner: true,
      cleanText: text.replace(/\[inner\]/g, '').trim(),
    };
  }

  // 检测中文圆括号包裹
  if (text.startsWith('（') && text.endsWith('）')) {
    return { isInner: true, cleanText: text };
  }

  // 检测英文圆括号包裹
  if (text.startsWith('(') && text.endsWith(')')) {
    return { isInner: true, cleanText: text };
  }

  return { isInner: false, cleanText: text };
}

/**
 * 解析完整的对话脚本
 *
 * 核心逻辑：
 * 1. 提取 <ui> 标签内容
 * 2. 按行逐行处理（每行可能是指令行、文本行或混合行）
 * 3. 对每行提取指令和纯文本
 * 4. speaker 状态在行间继承（char 指令设置，直到下一个 char 指令）
 * 5. 只有包含纯文本内容的行才会生成对话段落
 *    （纯指令行的指令会累积到下一个有文本的行）
 */
export function parseDialogueScript(rawText: string): ParsedScript {
  const uiContent = extractUIContent(rawText);

  // 移除 HTML 注释 <!-- ... -->（可能跨行），与酒馆行为一致
  const stripped = uiContent.replace(/<!--[\s\S]*?-->/g, '');

  const lines = stripped
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const segments: DialogueSegment[] = [];
  let currentSpeaker = '';
  let segmentIndex = 0;

  // 累积的待应用效果（来自纯指令行）
  let pendingEffects: SegmentEffects = {};

  // 累积的待应用选项（来自纯指令行）
  let pendingOptions: DialogueOption[] = [];

  for (const line of lines) {
    const { effects, cleanText, options, textJa, textZh } = extractCommands(line);

    // 合并待应用效果和当前行效果（当前行优先，但 stats/collections 数组做 concat）
    const mergedEffects: SegmentEffects = { ...pendingEffects, ...effects };
    // stats 数组：concat 而非覆盖（纯指令行的 stats 不能丢失）
    if (pendingEffects.stats || effects.stats) {
      mergedEffects.stats = [...(pendingEffects.stats || []), ...(effects.stats || [])];
    }
    // collections 数组：同理
    if (pendingEffects.collections || effects.collections) {
      mergedEffects.collections = [...(pendingEffects.collections || []), ...(effects.collections || [])];
    }
    // 合并待应用选项和当前行选项
    const mergedOptions: DialogueOption[] = [...pendingOptions, ...options];

    // 更新全局 speaker 状态
    if (mergedEffects.char) {
      currentSpeaker = mergedEffects.char;
    }

    // 如果行没有纯文本内容且没有双语标记且没有选项，将效果和选项累积到下一行
    if (!cleanText && !textJa && mergedOptions.length === 0) {
      pendingEffects = mergedEffects;
      pendingOptions = mergedOptions;
      continue;
    }

    // 如果只有选项没有文本也没有双语标记，将选项附加到上一个段落
    if (!cleanText && !textJa && mergedOptions.length > 0 && segments.length > 0) {
      segments[segments.length - 1].options.push(...mergedOptions);
      pendingEffects = mergedEffects;
      pendingOptions = [];
      continue;
    }

    // 检测内心独白
    const { isInner, cleanText: finalText } = detectInnerMonologue(cleanText);

    // 跳过空文本段落（可能由剥离标签后残留的空行产生）
    // 但如果有 textJa，即使 finalText 为空也要保留（纯双语标记的情况）
    if (!finalText && !textJa) {
      pendingEffects = mergedEffects;
      pendingOptions = mergedOptions;
      continue;
    }

    segments.push({
      id: `seg_${segmentIndex++}`,
      speaker: currentSpeaker || '旁白',
      text: finalText,
      textJa, // 日语原文（如果有）
      textZh, // 中文释义（如果有）
      effects: mergedEffects,
      isInnerMonologue: isInner,
      options: mergedOptions,
    });

    // 清空待应用效果和选项
    pendingEffects = {};
    pendingOptions = [];
  }

  // 如果还有未消费的选项，附加到最后一个段落
  if (pendingOptions.length > 0 && segments.length > 0) {
    segments[segments.length - 1].options.push(...pendingOptions);
  }

  // 如果还有未消费的 pendingEffects（纯指令行在末尾），附加到最后一个段落
  if (segments.length > 0) {
    const last = segments[segments.length - 1];
    if (pendingEffects.stats && pendingEffects.stats.length > 0) {
      last.effects.stats = [...(last.effects.stats || []), ...pendingEffects.stats];
    }
    if (pendingEffects.collections && pendingEffects.collections.length > 0) {
      last.effects.collections = [...(last.effects.collections || []), ...pendingEffects.collections];
    }
    // 其他标量效果（bg/bgm/char/face/desc 等）也合并（后者优先）
    for (const key of Object.keys(pendingEffects) as (keyof SegmentEffects)[]) {
      if (key !== 'stats' && key !== 'collections' && pendingEffects[key] !== undefined) {
        (last.effects as any)[key] = pendingEffects[key];
      }
    }
  }

  return { segments, skitLines: extractSkit(rawText) };
}

/**
 * 从原始消息文本中提取最后一个 [desc:] 指令的值
 * 用于往前遍历历史楼层时恢复最近的角色描述
 * 返回 null 表示该消息中没有 [desc:] 指令
 */
export function extractLastDesc(rawText: string): string | null {
  const uiContent = extractUIContent(rawText);
  const descRegex = /\[desc:([^\]]+)\]/g;
  let lastDesc: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = descRegex.exec(uiContent)) !== null) {
    lastDesc = match[1].trim();
  }
  return lastDesc;
}

/** 从 [bg:] 指令提取的完整背景信息（含 bgKey，用于资源解析） */
export interface BgFullState {
  场景: string;
  威胁等级: ThreatLevel;
  时间: string;
  bgKey: string;
}

/**
 * 从原始消息文本中提取最后一个 [bg:] 指令的世界状态（场景/威胁度/时间）
 * 用于往前遍历历史楼层时恢复最近的世界状态
 * 返回 null 表示该消息中没有 [bg:] 指令
 */
export function extractLastBgState(rawText: string): BgWorldState | null {
  const full = extractLastBgFull(rawText);
  if (!full) return null;
  return { 场景: full.场景, 威胁等级: full.威胁等级, 时间: full.时间 };
}

/**
 * 从原始消息文本中提取最后一个 [bg:] 指令的完整信息（含 bgKey）
 * 用于往前遍历历史楼层时恢复最近的背景图和世界状态
 * 返回 null 表示该消息中没有 [bg:] 指令
 */
export function extractLastBgFull(rawText: string): BgFullState | null {
  const uiContent = extractUIContent(rawText);
  const bgRegex = /\[bg:([^\]]+)\]/g;
  let lastState: BgFullState | null = null;
  let match: RegExpExecArray | null;
  while ((match = bgRegex.exec(uiContent)) !== null) {
    const parts = match[1].split('|').map(s => s.trim());
    lastState = {
      场景: parts[0] || '',
      威胁等级: (parts[1] as ThreatLevel) || '低',
      时间: parts[2] || '',
      bgKey: parts[3] || '',
    };
  }
  return lastState;
}

/** 表示"停止 BGM"的指令值集合 */
const BGM_STOP_VALUES = new Set(['无', '停止', 'stop', 'none', '']);

/**
 * 从原始消息文本中提取最后一个 [bgm:] 指令的值
 * 用于往前遍历历史楼层时恢复最近的 BGM 状态
 * 返回 null 表示该消息中没有 [bgm:] 指令
 * 返回 '' 表示该消息中有显式停止 BGM 的指令（如 [bgm:无]）
 */
export function extractLastBgm(rawText: string): string | null {
  const uiContent = extractUIContent(rawText);
  const bgmRegex = /\[bgm:([^\]]*)\]/g;
  let lastBgm: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = bgmRegex.exec(uiContent)) !== null) {
    const value = match[1].trim();
    lastBgm = BGM_STOP_VALUES.has(value) ? '' : value;
  }
  return lastBgm;
}

/**
 * 根据资源配置解析立绘图 URL
 * 如果资源不存在，返回空字符串（静默跳过）
 * 当没有指定 face 时，自动使用第一个可用的立绘作为 fallback
 */
export function resolveCharacterImage(config: ResourceConfig, charName: string, face?: string): string {
  const charImages = config.characters[charName];
  if (!charImages) return '';

  if (face && charImages[face]) {
    return charImages[face];
  }

  // 尝试使用默认立绘
  if (charImages['默认']) return charImages['默认'];
  if (charImages['default']) return charImages['default'];

  // 最终 fallback：使用该角色的第一个可用立绘
  const keys = Object.keys(charImages);
  return keys.length > 0 ? charImages[keys[0]] : '';
}

/**
 * 根据资源配置解析背景图 URL
 */
export function resolveBackgroundImage(config: ResourceConfig, bgName: string, bgKey?: string): string {
  // 优先使用资源 key（三段式第三段），其次用场景记名称
  if (bgKey && config.backgrounds[bgKey]) return config.backgrounds[bgKey];
  return config.backgrounds[bgName] || '';
}

/**
 * 根据资源配置解析 BGM URL
 */
export function resolveBgmUrl(config: ResourceConfig, bgmName: string): string {
  return config.bgm[bgmName] || '';
}

/**
 * 根据资源配置解析 CG 图 URL
 */
export function resolveCgImage(config: ResourceConfig, cgName: string): string {
  return config.cg[cgName] || '';
}

// ============ 富文本渲染（兼容酒馆 markdown 语法 + 打字机截断） ============

/** 内联 markdown 语法规则，按优先级排列（长标记优先匹配） */
const INLINE_RULES: Array<{ pattern: RegExp; tag: string }> = [
  { pattern: /\*\*\*(.+?)\*\*\*/, tag: 'b-i' }, // ***粗斜体***
  { pattern: /\*\*(.+?)\*\*/, tag: 'b' }, // **粗体**
  { pattern: /\*(.+?)\*/, tag: 'i' }, // *斜体*
  { pattern: /__(.+?)__/, tag: 'u' }, // __下划线__
  { pattern: /~~(.+?)~~/, tag: 's' }, // ~~删除线~~
  { pattern: /`(.+?)`/, tag: 'code' }, // `代码`
];

/**
 * 富文本 token：要么是一个 HTML 标签（不占可见字符），要么是一段纯文本（每个字符都是可见字符）
 */
interface RichToken {
  type: 'tag' | 'text';
  value: string;
}

/**
 * 将 markdown 文本解析为 token 序列。
 * 递归处理嵌套语法（如 ***粗斜体*** = <b><i>...</i></b>）。
 */
function tokenize(text: string): RichToken[] {
  if (!text) return [];

  // 对文本中所有规则做一次扫描，找到最早出现的匹配
  let earliest: { rule: (typeof INLINE_RULES)[0]; match: RegExpExecArray } | null = null;

  for (const rule of INLINE_RULES) {
    const re = new RegExp(rule.pattern.source); // 非全局，只找第一个
    const m = re.exec(text);
    if (m && (earliest === null || m.index < earliest.match.index)) {
      earliest = { rule, match: m };
    }
  }

  if (!earliest) {
    // 没有任何 markdown 语法，整段都是纯文本
    return [{ type: 'text', value: escapeHtml(text) }];
  }

  const { rule, match } = earliest;
  const before = text.slice(0, match.index);
  const inner = match[1];
  const after = text.slice(match.index + match[0].length);

  const tokens: RichToken[] = [];

  // 匹配前的纯文本
  if (before) tokens.push({ type: 'text', value: escapeHtml(before) });

  // 处理特殊的 b-i（粗斜体）：拆成 <b><i>...</i></b>
  if (rule.tag === 'b-i') {
    tokens.push({ type: 'tag', value: '<b>' });
    tokens.push({ type: 'tag', value: '<i>' });
    tokens.push(...tokenize(inner)); // 递归处理内部
    tokens.push({ type: 'tag', value: '</i>' });
    tokens.push({ type: 'tag', value: '</b>' });
  } else {
    tokens.push({ type: 'tag', value: `<${rule.tag}>` });
    tokens.push(...tokenize(inner)); // 递归处理内部
    tokens.push({ type: 'tag', value: `</${rule.tag}>` });
  }

  // 匹配后的剩余文本（递归）
  if (after) tokens.push(...tokenize(after));

  return tokens;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
}

/**
 * 将 token 序列拼接为 HTML 字符串
 */
function tokensToHtml(tokens: RichToken[]): string {
  return tokens.map(t => t.value).join('');
}

// ============ tokenize 缓存：避免打字机每帧重复解析 ============
const _tokenCache = new Map<string, RichToken[]>();
const TOKEN_CACHE_MAX = 32;

/** 带缓存的 tokenize，同一段文本只解析一次 */
function tokenizeCached(text: string): RichToken[] {
  const cached = _tokenCache.get(text);
  if (cached) return cached;
  const tokens = tokenize(text);
  if (_tokenCache.size >= TOKEN_CACHE_MAX) {
    // 淘汰最早的条目
    const firstKey = _tokenCache.keys().next().value;
    if (firstKey !== undefined) _tokenCache.delete(firstKey);
  }
  _tokenCache.set(text, tokens);
  return tokens;
}

/**
 * 预解析结果：包含 tokens、可见字符总数、以及每个 text token 的预拆分字符数组。
 * 打字机 tick 时直接使用此结构，无需重复计算。
 */
export interface PreparedRichText {
  tokens: RichToken[];
  totalVisible: number;
  /** 每个 text token 对应的预拆分逻辑字符数组（tag token 对应 null） */
  splitChars: (string[] | null)[];
  /** 完整 HTML 字符串 */
  fullHtml: string;
}

/**
 * 一次性预解析文本，返回打字机所需的全部数据。
 * 在段落切换时调用一次，后续 tick 只做 slice 操作。
 */
export function prepareRichText(text: string): PreparedRichText {
  const tokens = tokenizeCached(text);
  let totalVisible = 0;
  const splitChars: (string[] | null)[] = [];

  for (const t of tokens) {
    if (t.type === 'text') {
      const chars = splitEscapedText(t.value);
      splitChars.push(chars);
      totalVisible += chars.length;
    } else {
      splitChars.push(null);
    }
  }

  return { tokens, totalVisible, splitChars, fullHtml: tokensToHtml(tokens) };
}

/**
 * 基于预解析结果，快速截取前 visibleCount 个可见字符的 HTML。
 * 不再重新 tokenize，只做数组遍历和字符串拼接。
 */
export function slicePreparedRichText(prepared: PreparedRichText, visibleCount: number): string {
  const { tokens, splitChars } = prepared;
  const result: string[] = [];
  const openTags: string[] = [];
  let remaining = visibleCount;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (remaining <= 0 && token.type === 'text') break;

    if (token.type === 'tag') {
      if (token.value.startsWith('</')) {
        result.push(token.value);
        openTags.pop();
      } else {
        result.push(token.value);
        const tagName = token.value.replace(/[<>]/g, '');
        openTags.push(tagName);
      }
    } else {
      const chars = splitChars[i]!;
      if (chars.length <= remaining) {
        result.push(token.value);
        remaining -= chars.length;
      } else {
        result.push(chars.slice(0, remaining).join(''));
        remaining = 0;
      }
    }
  }

  for (let i = openTags.length - 1; i >= 0; i--) {
    result.push(`</${openTags[i]}>`);
  }

  return result.join('');
}

/**
 * 计算 token 序列中的可见字符总数
 */
export function countVisibleChars(text: string): number {
  const tokens = tokenizeCached(text);
  let count = 0;
  for (const t of tokens) {
    if (t.type === 'text') count += [...t.value.replace(/&|<|>/g, '_')].length;
  }
  return count;
}

/**
 * 将 markdown 文本完整渲染为 HTML
 */
export function renderRichText(text: string): string {
  return tokensToHtml(tokenizeCached(text));
}

/**
 * 将 markdown 文本渲染为 HTML，但只显示前 visibleCount 个可见字符。
 * 所有打开的标签都会被正确闭合，确保 HTML 始终合法。
 *
 * 这是打字机效果的核心：每次 tick 增加 visibleCount，
 * 输出的 HTML 始终包含正确的格式标签，不会暴露 ** 等原始标记。
 *
 * 注意：优先使用 prepareRichText + slicePreparedRichText 组合以获得更好性能。
 */
export function renderRichTextSlice(text: string, visibleCount: number): string {
  const tokens = tokenizeCached(text);
  const result: string[] = [];
  const openTags: string[] = []; // 栈：记录已打开但未关闭的标签
  let remaining = visibleCount;

  for (const token of tokens) {
    if (remaining <= 0 && token.type === 'text') break;

    if (token.type === 'tag') {
      if (token.value.startsWith('</')) {
        // 闭合标签：从栈中弹出
        result.push(token.value);
        openTags.pop();
      } else {
        // 开启标签：压入栈
        result.push(token.value);
        // 提取标签名用于后续闭合
        const tagName = token.value.replace(/[<>]/g, '');
        openTags.push(tagName);
      }
    } else {
      // 纯文本 token（已经过 escapeHtml）
      // 需要按"实际字符"计数，但 value 中 & < > 各算一个字符
      const chars = splitEscapedText(token.value);
      if (chars.length <= remaining) {
        result.push(token.value);
        remaining -= chars.length;
      } else {
        // 只取前 remaining 个字符
        result.push(chars.slice(0, remaining).join(''));
        remaining = 0;
      }
    }
  }

  // 闭合所有仍然打开的标签（逆序）
  for (let i = openTags.length - 1; i >= 0; i--) {
    result.push(`</${openTags[i]}>`);
  }

  return result.join('');
}

/**
 * 将已转义的 HTML 文本拆分为"逻辑字符"数组。
 * & < > 各视为一个字符。
 */
function splitEscapedText(escaped: string): string[] {
  const chars: string[] = [];
  let i = 0;
  while (i < escaped.length) {
    if (escaped[i] === '&') {
      const semi = escaped.indexOf(';', i);
      if (semi !== -1) {
        chars.push(escaped.slice(i, semi + 1));
        i = semi + 1;
        continue;
      }
    }
    chars.push(escaped[i]);
    i++;
  }
  return chars;
}
