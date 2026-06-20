/**
 * 情绪标签 LLM 服务
 * 负责为有音色配置的角色台词自动添加情绪标签以优化配音效果
 */

import type { CharacterVoiceSettings, DialogueSegment, EmotionTagLLMConfig } from '../types';

/** 单次请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 60000; // 60 秒
/** 网络错误时的最大重试次数 */
const MAX_RETRIES = 2;
/** 重试基础延迟（毫秒） */
const RETRY_BASE_DELAY_MS = 1500;

/** 情绪标签处理结果 */
export interface EmotionTagResult {
  [segmentId: string]: {
    styleTag?: string;
    textWithInlineTags: string;
  };
}

/**
 * 规范化 endpoint：确保以 /chat/completions 结尾
 */
function normalizeEndpoint(raw: string): string {
  let endpoint = raw.trim();
  if (endpoint.endsWith('/chat/completions')) return endpoint;
  if (!endpoint.endsWith('/')) endpoint += '/';
  if (endpoint.endsWith('/v1/')) {
    endpoint += 'chat/completions';
  } else {
    endpoint += 'v1/chat/completions';
  }
  return endpoint;
}

/** 判断错误是否值得重试 */
function isRetriableError(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === 'AbortError') return true;
    if (err.name === 'TypeError' && /failed to fetch|network|load failed/i.test(err.message)) return true;
    if (/^情绪标签 LLM 请求失败 \(5\d{2}\)/.test(err.message)) return true;
  }
  return false;
}

/** 转换 fetch 错误为可读的中文错误 */
function humanizeFetchError(err: unknown, endpoint: string): Error {
  if (err instanceof Error) {
    if (err.name === 'AbortError') {
      return new Error(`情绪标签 LLM 请求超时（>${REQUEST_TIMEOUT_MS / 1000}s）：无法连接 ${endpoint}`);
    }
    if (err.name === 'TypeError' && /failed to fetch|network|load failed/i.test(err.message)) {
      return new Error(`情绪标签 LLM 网络错误：${endpoint}\n原始错误: ${err.message}`);
    }
    return err;
  }
  return new Error(`情绪标签 LLM 未知错误: ${String(err)}`);
}

/**
 * 调用情绪标签 LLM API
 */
async function callEmotionTagLLMAPI(
  config: EmotionTagLLMConfig,
  requestBody: object,
  signal?: AbortSignal,
): Promise<string> {
  const endpoint = config.baseURL ? normalizeEndpoint(config.baseURL) : 'https://api.openai.com/v1/chat/completions';

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (REQUEST_TIMEOUT_MS > 0) {
      timer = setTimeout(() => {
        controller.abort();
      }, REQUEST_TIMEOUT_MS);
    }

    if (signal?.aborted) {
      if (timer) clearTimeout(timer);
      throw new Error('请求已被外部中止');
    }

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
        console.error(`[emotionTagLLM] 错误响应:`, errorText);
        const err = new Error(`情绪标签 LLM 请求失败 (${response.status}): ${errorText || response.statusText}`);
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
        console.error(`[emotionTagLLM] JSON 解析失败:`, parseErr);
        throw new Error(`情绪标签 LLM 返回的不是有效 JSON`);
      }

      const message = data?.choices?.[0]?.message;
      let content = message?.content;

      if (!content && message?.reasoning_content) {
        content = message.reasoning_content;
      }

      if (!content || content.trim() === '') {
        throw new Error('情绪标签 LLM 返回内容为空');
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

  throw humanizeFetchError(lastError, endpoint);
}

/**
 * 构建情绪标签 LLM 的 System Prompt
 */
function buildSystemPrompt(): string {
  return `你是一个配音导演，负责为角色台词添加情绪标签以控制TTS语音效果。

## 标签类型

### 1. 段落级风格标签（放在台词开头）
格式：(风格1 风格2)

可用风格：
- 基础情绪：开心/悲伤/愤怒/恐惧/惊讶/兴奋/委屈/平静/冷漠
- 复合情绪：怅然/欣慰/无奈/愧疚/释然/嫉妒/厌倦/忐忑/动情
- 整体语调：温柔/高冷/活泼/严肃/慵懒/俏皮/深沉/干练/凌厉
- 音色定位：磁性/醇厚/清亮/空灵/稚嫩/苍老/甜美/沙哑/醇雅

### 2. 内联标签（插入台词中）
格式：[标签]

可用标签：
- 呼吸：吸气/深呼吸/叹气/长叹一口气/喘息/屏息
- 情绪状态：紧张/害怕/激动/疲惫/委屈/撒娇/心虚/震惊/不耐烦
- 语音特征：颤抖/声音颤抖/变调/破音/鼻音/气声/沙哑
- 哭笑表达：笑/轻笑/大笑/冷笑/抽泣/呜咽/哽咽/嚎啕大哭

## 使用原则
- 根据角色表情、台词内容和角色性格判断情绪
- 不要过度使用标签，保持自然
- 只在情绪明显时添加段落级标签
- 内联标签用于细腻的情感表达
- 结合上下文理解角色的情绪变化

## 输出格式
严格返回 JSON 格式，不要有任何其他文本：
{
  "段落ID1": {
    "styleTag": "(悲伤 哽咽)",
    "textWithInlineTags": "[吸气]台词内容..."
  },
  "段落ID2": {
    "textWithInlineTags": "台词内容[轻笑]继续..."
  }
}

如果某段不需要标签，可以省略 styleTag 字段，但 textWithInlineTags 必须保留（即使没有内联标签）。`;
}

/**
 * 构建 User Prompt
 */
function buildUserPrompt(segments: DialogueSegment[], characterVoices: Record<string, CharacterVoiceSettings>): string {
  // 提取角色信息
  const characterInfoLines: string[] = [];
  const voiceCharacterNames = Object.keys(characterVoices);

  for (const name of voiceCharacterNames) {
    const settings = characterVoices[name];
    const info = settings.characterInfo || '（无角色信息）';
    characterInfoLines.push(`${name}: ${info}`);
  }

  // 构建台词列表
  const dialogueLines: string[] = [];
  for (const seg of segments) {
    const faceInfo = seg.effects.face ? ` [${seg.effects.face}]` : '';
    const text = seg.textJa || seg.text;
    dialogueLines.push(`[${seg.id}] ${seg.speaker}${faceInfo}: ${text}`);
  }

  return `请为以下角色台词添加情绪标签，结合台词所在上下文和角色信息，判断角色的情绪状态。

# 角色信息
${characterInfoLines.join('\n')}

# 完整对话
${dialogueLines.join('\n')}

请为有音色配置的角色（${voiceCharacterNames.join('、')}）添加情绪标签。

返回 JSON 格式的情绪标签。`;
}

/**
 * 处理楼层所有台词，生成情绪标签
 * @param segments 所有对话段落（包括旁白）
 * @param characterVoices 角色音色配置
 * @param config 情绪标签 LLM 配置
 * @param signal 可选的 AbortSignal
 * @returns 情绪标签结果
 */
export async function processSegments(
  segments: DialogueSegment[],
  characterVoices: Record<string, CharacterVoiceSettings>,
  config: EmotionTagLLMConfig,
  signal?: AbortSignal,
): Promise<EmotionTagResult> {
  // 如果没有启用，返回空结果
  if (!config.enabled) {
    console.log('[emotionTagLLM] 功能未启用');
    return {};
  }

  // 如果没有配置 API Key，返回空结果
  if (!config.apiKey || config.apiKey.trim() === '') {
    console.warn('[emotionTagLLM] API Key 未配置，跳过情绪标签生成');
    return {};
  }

  // 过滤出有音色配置的角色
  const voiceCharacterNames = Object.keys(characterVoices);
  if (voiceCharacterNames.length === 0) {
    return {};
  }

  // 构建请求
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(segments, characterVoices);

  const requestBody = {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 2000,
  };
  try {
    const responseContent = await callEmotionTagLLMAPI(config, requestBody, signal);

    // 提取 JSON（可能被 markdown 代码块包裹）
    let jsonText = responseContent.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    }

    // 解析 JSON
    const result: EmotionTagResult = JSON.parse(jsonText);

    return result;
  } catch (error) {
    console.error('[emotionTagLLM] ❌ 情绪标签生成失败:', error);
    // 失败时返回空结果，不阻塞播放
    return {};
  }
}
