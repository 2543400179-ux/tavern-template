/**
 * 导演 LLM 服务
 * 负责调用独立配置的 LLM 分析文本，决定 CG 插入位置并生成画面描述 tags
 */

import type { DirectorAnalysisItem, DirectorLLMConfig, DirectorRangeAnalysisItem } from '../types';

/** 单次请求超时（毫秒）- 设为 0 表示不限制超时，让 API 自然完成或失败 */
const REQUEST_TIMEOUT_MS = 300000; // 300 秒超时（5 分钟）- 手机网络可能较慢
/** 网络错误时的最大重试次数（不含首次） */
const MAX_RETRIES = 2;
/** 重试基础延迟（毫秒），按指数回退 */
const RETRY_BASE_DELAY_MS = 1500;

/**
 * 规范化 endpoint：确保以 /chat/completions 结尾，并去除首尾空格
 */
function normalizeEndpoint(raw: string): string {
  let endpoint = raw.trim(); // 去除首尾空格
  if (endpoint.endsWith('/chat/completions')) return endpoint;
  if (!endpoint.endsWith('/')) endpoint += '/';
  if (endpoint.endsWith('/v1/')) {
    endpoint += 'chat/completions';
  } else {
    endpoint += 'v1/chat/completions';
  }
  return endpoint;
}

/** 判断错误是否值得重试（网络层错误或 5xx） */
function isRetriableError(err: unknown): boolean {
  if (err instanceof Error) {
    // AbortError 来自我们自己的超时，按网络问题处理
    if (err.name === 'AbortError') return true;
    // fetch 网络层失败 (DNS / 连接被拒 / 超时 / CORS) 在浏览器里表现为 TypeError: Failed to fetch
    if (err.name === 'TypeError' && /failed to fetch|network|load failed/i.test(err.message)) return true;
    // 我们抛出的带 5xx 的错误
    if (/^导演 LLM 请求失败 \(5\d{2}\)/.test(err.message)) return true;
  }
  return false;
}

/** 把底层 fetch 错误转成更易读的中文错误 */
function humanizeFetchError(err: unknown, endpoint: string): Error {
  if (err instanceof Error) {
    if (err.name === 'AbortError') {
      return new Error(
        `导演 LLM 请求超时（>${REQUEST_TIMEOUT_MS / 1000}s）：无法连接 ${endpoint}，请检查网络或更换中转站`,
      );
    }
    if (err.name === 'TypeError' && /failed to fetch|network|load failed/i.test(err.message)) {
      return new Error(
        `导演 LLM 网络错误：${endpoint}\n` +
          `原始错误: ${err.message}\n` +
          `可能原因：\n` +
          `1. CORS 跨域问题（请确保 API 服务器允许跨域）\n` +
          `2. 网络连接失败（DNS 无法解析或服务器不可达）\n` +
          `3. 防火墙或代理拦截\n` +
          `4. API endpoint 地址错误\n` +
          `建议：在浏览器控制台查看详细的网络错误`,
      );
    }
    // 如果已经是我们自己包装的错误，直接返回
    return err;
  }
  return new Error(`导演 LLM 未知错误: ${String(err)}`);
}

/**
 * 共享的 LLM 请求函数：带超时 + 有限重试 + 错误转译
 * 返回 LLM 输出的纯文本 content
 * @param signal 可选的 AbortSignal，用于外部中断请求
 */
async function callDirectorLLMAPI(
  config: DirectorLLMConfig,
  requestBody: object,
  signal?: AbortSignal,
): Promise<string> {
  const endpoint = normalizeEndpoint(config.endpoint);

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const startTime = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    // 只有在设置了超时时间时才启用超时
    if (REQUEST_TIMEOUT_MS > 0) {
      timer = setTimeout(() => {
        controller.abort();
      }, REQUEST_TIMEOUT_MS);
    }

    // 如果外部 signal 已经中止，直接抛出
    if (signal?.aborted) {
      if (timer) clearTimeout(timer);
      throw new Error('请求已被外部中止');
    }

    // 监听外部 signal 的中止事件
    const externalAbortHandler = () => {
      controller.abort();
    };
    signal?.addEventListener('abort', externalAbortHandler);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error(`[directorLLM] 错误响应 body:`, errorText);
        const err = new Error(`导演 LLM 请求失败 (${response.status}): ${errorText || response.statusText}`);
        // 5xx 才重试，4xx 直接抛
        if (response.status >= 500 && attempt < MAX_RETRIES) {
          lastError = err;
          await new Promise(r => setTimeout(r, RETRY_BASE_DELAY_MS * Math.pow(2, attempt)));
          continue;
        }
        throw err;
      }

      const responseText = await response.text();

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseErr) {
        console.error(`[directorLLM] JSON 解析失败:`, parseErr);
        console.error(`[directorLLM] 原始响应:`, responseText);
        throw new Error(`导演 LLM 返回的不是有效 JSON: ${parseErr}`);
      }

      // 支持标准 OpenAI 格式和 DeepSeek 推理模型格式
      const message = data?.choices?.[0]?.message;
      let content = message?.content;
      
      // DeepSeek 推理模型把内容放在 reasoning_content 中
      if (!content && message?.reasoning_content) {
        content = message.reasoning_content;
      }
      
      if (!content || content.trim() === '') {
        console.error(`[directorLLM] 响应结构异常，完整数据:`, data);
        console.error(`[directorLLM] choices 数组:`, data?.choices);
        console.error(`[directorLLM] choices[0]:`, data?.choices?.[0]);
        console.error(`[directorLLM] message:`, message);
        
        // 检查是否因为 max_tokens 不足导致截断
        const finishReason = data?.choices?.[0]?.finish_reason;
        if (finishReason === 'length') {
          throw new Error('导演 LLM 响应被截断（finish_reason: length）\n建议：增加 max_tokens 参数或简化输入文本');
        }
        
        throw new Error('导演 LLM 返回内容为空或结构不符合预期');
      }

      return content;
    } catch (e) {
      lastError = e;

      if (attempt < MAX_RETRIES && isRetriableError(e)) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw humanizeFetchError(e, endpoint);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', externalAbortHandler);
    }
  }

  // 兜底（理论上不会走到）
  throw humanizeFetchError(lastError, endpoint);
}

/**
 * 构建导演 LLM 的 System Prompt
 * @param minCount 最少生成数量（可选）
 * @param maxCount 最多生成数量（可选）
 */
function buildDirectorSystemPrompt(minCount?: number, maxCount?: number): string {
  let countRule = '1~3 个';
  if (minCount !== undefined && maxCount !== undefined) {
    countRule = minCount === maxCount ? `恰好 ${minCount} 个` : `${minCount}~${maxCount} 个`;
  } else if (minCount !== undefined) {
    countRule = `至少 ${minCount} 个`;
  } else if (maxCount !== undefined) {
    countRule = `最多 ${maxCount} 个`;
  }

  return `你是一位视觉小说的"画面导演"。你的任务是阅读一段小说文本，从中挑选出最适合配上 CG 插图的关键段落，并为每个选中的段落生成 Danbooru 风格的画面描述标签（tags）。

## 关键要求：分离角色与场景
- **tags 字段**：只描述场景环境、光影氛围、构图、动作（如 ruins, sunset, dramatic lighting, embrace, close-up）
- **characters 字段**：单独列出画面中的每个角色及其外貌、位置
- 这种分离能让 NovelAI V4 正确生成多人场景，避免角色混淆

## 规则
1. 从给定的段落列表中，选出 ${countRule} 最具视觉冲击力、情感张力或叙事转折的段落。
2. 为每个选中的段落生成场景 tags（不含角色外貌）和角色列表。
3. 不要包含任何 NSFW 内容。
4. 严格按照指定的 JSON 格式输出，不要输出任何其他内容。

## 输出格式
返回一个 JSON 数组，每个元素包含：
- paragraphIndex: 段落索引（从 0 开始）
- tags: 场景描述 tags（环境、光影、构图、动作，不含角色外貌）
- characters: 角色列表数组，每个角色包含：
  - char_caption: 该角色的外貌描述 tags（参考角色外貌库）
  - centers: 该角色在画面中的位置，数组格式 [{"x": 0.5, "y": 0.5}]，x 和 y 取值 0~1
- reason: 简短说明选择该段落的理由（中文）

\`\`\`json
[
  {
    "paragraphIndex": 2,
    "tags": "standing, ruins, post-apocalyptic, sunset, dramatic lighting, from below, wind",
    "characters": [
      {
        "char_caption": "1girl, silver hair, long hair, red eyes, torn clothes",
        "centers": [{"x": 0.5, "y": 0.5}]
      }
    ],
    "reason": "角色首次登场的关键视觉时刻"
  },
  {
    "paragraphIndex": 15,
    "tags": "close-up, emotional, tears, embrace, indoor, dim lighting, window light, melancholic atmosphere",
    "characters": [
      {
        "char_caption": "1girl, silver hair, long hair, red eyes, sad expression",
        "centers": [{"x": 0.4, "y": 0.5}]
      },
      {
        "char_caption": "1girl, black hair, short hair, green eyes, comforting expression",
        "centers": [{"x": 0.6, "y": 0.5}]
      }
    ],
    "reason": "情感高潮的告别场景，两人拥抱"
  }
]
\`\`\``;
}

/**
 * 从 LLM 返回的文本中提取 JSON 数组
 * 支持从 markdown 代码块中提取
 */
function extractJsonFromResponse(text: string): DirectorAnalysisItem[] {
  // 尝试从 markdown 代码块中提取
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) {
      return [parsed].filter(isValidItem);
    }
    return parsed.filter(isValidItem);
  } catch (e) {
    // 尝试用正则逐个提取对象
    const items: DirectorAnalysisItem[] = [];
    const objRegex = /\{[^{}]*"paragraphIndex"\s*:\s*(\d+)[^{}]*"tags"\s*:\s*"([^"]*)"[^{}]*\}/g;
    let match;
    while ((match = objRegex.exec(text)) !== null) {
      items.push({
        paragraphIndex: parseInt(match[1], 10),
        tags: match[2],
      });
    }
    return items;
  }
}

/** 校验单个分析结果是否有效 */
function isValidItem(item: any): item is DirectorAnalysisItem {
  return (
    item &&
    typeof item.paragraphIndex === 'number' &&
    Number.isInteger(item.paragraphIndex) &&
    item.paragraphIndex >= 0 &&
    typeof item.tags === 'string' &&
    item.tags.trim().length > 0
  );
}

/**
 * 调用导演 LLM 分析文本段落
 * @param paragraphs 文本段落数组
 * @param config 导演 LLM 配置
 * @returns 分析结果数组
 */
export async function analyzeWithDirectorLLM(
  paragraphs: string[],
  config: DirectorLLMConfig,
  characterAppearances?: Record<string, string>,
): Promise<DirectorAnalysisItem[]> {
  if (!config.endpoint || !config.apiKey || !config.model) {
    throw new Error('导演 LLM 配置不完整：请检查 endpoint、apiKey 和 model');
  }

  // 构建 system prompt：基础 + 角色外貌参考（如果有）
  let systemPrompt = buildDirectorSystemPrompt(config.minCGCount, config.maxCGCount);
  if (characterAppearances && Object.keys(characterAppearances).length > 0) {
    const appearanceLines = Object.entries(characterAppearances)
      .map(([name, tags]) => `- ${name}：${tags}`)
      .join('\n');
    systemPrompt += `\n\n## 角色外貌库（仅供参考，非强制）

${appearanceLines}

**重要规则：**
1. 仔细识别文本中实际出现的角色名，以文本为准
2. 如果角色在外貌库中，使用其外貌描述
3. 如果角色不在外貌库中，根据文本自行编写外貌（格式：1girl/1boy, 发型, 发色, 眼睛, 服装）
4. 绝对不要为了使用外貌库而替换文本中的角色
5. 不要添加文本中没有的角色`;
  }

  // 构建用户消息：带索引的段落列表
  const userMessage = paragraphs.map((p, i) => `[${i}] ${p}`).join('\n\n');

  const requestBody = {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `请分析以下段落，选出适合配 CG 的段落并生成画面标签：\n\n${userMessage}` },
    ],
    temperature: 0.7,
    max_tokens: 8000, // 增加到 8000 以支持 DeepSeek 等推理模型
  };

  // 调用共享 API 函数（带超时 + 重试）
  const content = await callDirectorLLMAPI(config, requestBody);

  const items = extractJsonFromResponse(content);

  // 过滤掉超出段落范围的索引
  const validItems = items.filter(item => item.paragraphIndex < paragraphs.length);

  // 应用数量限制（如果设置了）
  if (config.maxCGCount !== undefined && validItems.length > config.maxCGCount) {
    return validItems.slice(0, config.maxCGCount);
  }

  return validItems;
}

// ====== 范围版本（新增）======

/**
 * 构建导演 LLM 的 System Prompt（范围版本）
 * @param minCount 最少生成数量（可选）
 * @param maxCount 最多生成数量（可选）
 * @param fullCoverageMode 全CG模式：所有段落都必须被CG覆盖
 */
function buildDirectorRangeSystemPrompt(minCount?: number, maxCount?: number, fullCoverageMode?: boolean): string {
  let countRule = '1~2 个';
  
  // 全CG模式下，忽略最小值限制，但保留最大值限制
  if (fullCoverageMode) {
    if (maxCount !== undefined) {
      countRule = `最多 ${maxCount} 个`;
    } else {
      countRule = '适量'; // 不限制数量，由 LLM 根据场景变化决定
    }
  } else {
    // 普通模式：按照用户配置的数量限制
    if (minCount !== undefined && maxCount !== undefined) {
      countRule = minCount === maxCount ? `恰好 ${minCount} 个` : `${minCount}~${maxCount} 个`;
    } else if (minCount !== undefined) {
      countRule = `至少 ${minCount} 个`;
    } else if (maxCount !== undefined) {
      countRule = `最多 ${maxCount} 个`;
    }
  }

  // 全CG模式下，要求覆盖所有段落
  const coverageInstruction = fullCoverageMode
    ? `\n\n⚠️ **全CG覆盖模式**：你必须确保所有段落（从第一段到最后一段）都被CG范围覆盖，不允许有任何段落没有CG。相邻的相似场景可以合并为同一个CG范围以减少生成数量，但不能留下空白段落。`
    : '';

  return `你是 Galgame CG 导演。从文本中选 ${countRule} CG 范围，为每个范围生成 NovelAI V4 的 Danbooru tags。${coverageInstruction}

# 输出格式
\`\`\`json
[
  {
    "startIndex": 2,
    "endIndex": 7,
    "tags": "upper body, bedroom, dim lighting",
    "characters": [
      {
        "char_caption": "外貌库基础tags, 表情, 动作, 视线",
        "centers": [{"x": 0.5, "y": 0.35}]
      }
    ],
    "reason": "选择理由"
  }
]
\`\`\`

# char_caption 填写公式（死记硬背）

**公式：外貌库基础 + 表情 + 动作 + 视线**

1. **先写外貌库基础**（会单独提供，逐字复制）
2. **逗号分隔，追加表情**（angry / smiling / blushing / crying / half-closed eyes）
3. **逗号分隔，追加动作**（straddling / choking / embracing / standing / sitting）
4. **逗号分隔，追加视线**（looking at another / eye contact / looking down / looking away）

**示例：**
- 外貌库基础："1girl, black hair, pink eyes, glasses"
- 完整 char_caption："1girl, black hair, pink eyes, glasses, aggressive expression, half-closed eyes, straddling, hands on another's neck, looking down at another"

# tags 填写规则

**公式：镜头 + 环境 + 光影**

只写场景信息，不写角色：
- 镜头：upper body / cowboy shot / close-up / from below
- 环境：bedroom / ruins / classroom / outdoor
- 光影：dim lighting / sunset / dramatic lighting / window light

# centers 坐标规则（根据动作类型选择）

**上下关系（骑乘/压制/躺卧）：**
- 上方角色：{"x": 0.5, "y": 0.35}
- 下方角色：{"x": 0.5, "y": 0.65}
- 示例动作：straddling, pinning down, on top of, lying down

**左右关系（对话/对峙/并肩）：**
- 左侧角色：{"x": 0.35, "y": 0.5}
- 右侧角色：{"x": 0.65, "y": 0.5}
- 示例动作：standing, talking, facing each other

**亲密接触（拥抱/亲吻）：**
- 角色1：{"x": 0.45, "y": 0.48}
- 角色2：{"x": 0.55, "y": 0.52}
- 示例动作：embracing, hugging, kissing

**单人画面：**
- 居中：{"x": 0.5, "y": 0.5}

**判断依据：看 char_caption 里的动作词，选对应布局**`;
}

/**
 * 从 LLM 返回的文本中提取范围 JSON 数组
 */
function extractRangeJsonFromResponse(text: string): DirectorRangeAnalysisItem[] {
  // 尝试从 markdown 代码块中提取
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) {
      return [parsed].filter(isValidRangeItem);
    }
    return parsed.filter(isValidRangeItem);
  } catch (e) {
    // 尝试用正则逐个提取对象
    const items: DirectorRangeAnalysisItem[] = [];
    const objRegex =
      /\{[^{}]*"startIndex"\s*:\s*(\d+)[^{}]*"endIndex"\s*:\s*(\d+)[^{}]*"tags"\s*:\s*"([^"]*)"[^{}]*\}/g;
    let match;
    while ((match = objRegex.exec(text)) !== null) {
      items.push({
        startIndex: parseInt(match[1], 10),
        endIndex: parseInt(match[2], 10),
        tags: match[3],
      });
    }
    return items;
  }
}

/** 校验单个范围分析结果是否有效 */
function isValidRangeItem(item: any): item is DirectorRangeAnalysisItem {
  return (
    item &&
    typeof item.startIndex === 'number' &&
    typeof item.endIndex === 'number' &&
    Number.isInteger(item.startIndex) &&
    Number.isInteger(item.endIndex) &&
    item.startIndex >= 0 &&
    item.endIndex >= item.startIndex &&
    typeof item.tags === 'string' &&
    item.tags.trim().length > 0
  );
}

/**
 * 调用导演 LLM 分析文本段落（范围版本）
 * @param paragraphs 文本段落数组
 * @param config 导演 LLM 配置
 * @param characterAppearances 角色外貌描述
 * @param signal 可选的 AbortSignal
 * @param fullCoverageMode 全CG模式：所有段落都必须被CG覆盖
 * @returns 范围分析结果数组
 */
export async function analyzeWithDirectorLLMRange(
  paragraphs: string[],
  config: DirectorLLMConfig,
  characterAppearances?: Record<string, string>,
  signal?: AbortSignal,
  fullCoverageMode?: boolean,
): Promise<DirectorRangeAnalysisItem[]> {
  if (!config.endpoint || !config.apiKey || !config.model) {
    throw new Error('导演 LLM 配置不完整：请检查 endpoint、apiKey 和 model');
  }

  // 如果段落过多（超过 150），只分析前 150 段，避免请求体过大导致超时
  const MAX_PARAGRAPHS = 150;
  const effectiveParagraphs = paragraphs.length > MAX_PARAGRAPHS 
    ? paragraphs.slice(0, MAX_PARAGRAPHS) 
    : paragraphs;
  
  if (paragraphs.length > MAX_PARAGRAPHS) {
    console.warn(`[directorLLM] 段落数量过多 (${paragraphs.length})，仅分析前 ${MAX_PARAGRAPHS} 段以避免超时`);
  }

  // 构建 system prompt：基础 + 角色外貌参考（如果有）
  let systemPrompt = buildDirectorRangeSystemPrompt(config.minCGCount, config.maxCGCount, fullCoverageMode);
  if (characterAppearances && Object.keys(characterAppearances).length > 0) {
    const appearanceLines = Object.entries(characterAppearances)
      .map(([name, tags]) => `- ${name}：${tags}`)
      .join('\n');
    systemPrompt += `\n\n# 角色外貌库（仅供参考，非强制）

${appearanceLines}

**char_caption 填写规则（重要）：**

**第1步：角色识别**
- 仔细阅读文本段落，识别实际出现的角色名
- 以文本中的角色为准，不要替换或添加文本中不存在的角色

**第2步：基础外貌来源**
- 如果该角色在外貌库中 → 复制其基础 tags（一字不改）
- 如果该角色不在外貌库中 → 根据文本描述自行编写基础外貌（格式：1girl/1boy, 发型, 发色, 眼睛特征, 服装等）

**第3步：追加动态信息**
- 表情：angry / smiling / blushing / crying / sad / happy / half-closed eyes
- 动作：straddling / standing / sitting / embracing / choking / lying down
- 视线：looking at another / eye contact / looking down / looking away / looking at viewer

**严格禁止：**
❌ 为了使用外貌库而替换剧情中的角色（如剧情是温留棠，绝对不能用月见莲）
❌ 省略表情、动作、视线（必须全部补充）
❌ 添加文本中没有出现的角色

**示例：**
- 剧情角色在库中："1girl, black hair, pink eyes, glasses, angry, half-closed eyes, straddling, looking down at another"
- 剧情角色不在库中："1girl, brown hair, gentle expression, white dress, smiling, standing, looking at viewer"`;
  }

  // 构建用户消息：带索引的段落列表
  const userMessage = effectiveParagraphs.map((p, i) => `[${i}] ${p}`).join('\n\n');

  const requestBody = {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `请分析以下段落，标记出适合配 CG 的段落范围并生成画面标签：\n\n${userMessage}` },
    ],
    temperature: 0.7,
    max_tokens: 8000, // 增加到 8000 以支持 DeepSeek 等推理模型
  };

  // 调用共享 API 函数（带超时 + 重试）
  const content = await callDirectorLLMAPI(config, requestBody, signal);
  
  const items = extractRangeJsonFromResponse(content);

  // 过滤掉超出段落范围的索引
  const validItems = items.filter(item => item.startIndex < effectiveParagraphs.length && item.endIndex < effectiveParagraphs.length);

  // 应用数量限制（如果设置了）
  if (config.maxCGCount !== undefined && validItems.length > config.maxCGCount) {
    return validItems.slice(0, config.maxCGCount);
  }

  return validItems;
}
