/**
 * Voice Service - 调用小米 MiMo V2.5 TTS API 实现角色语音播报
 * 官方文档：https://api.xiaomimimo.com/docs
 */

import type { CharacterVoiceSettings, VoiceConfig } from '../types';
import { getEmotionTags, makeEmotionTagCacheKey } from './emotionTagCacheDB';
import { getVoiceAudio, putVoiceAudio } from './voiceCacheDB';

/** 当前播放的音频实例（用于停止） */
let currentAudio: HTMLAudioElement | null = null;

/** 所有活跃的音频实例列表（用于清理） */
const activeAudios = new Set<HTMLAudioElement>();

/** 当前播放请求的唯一ID */
let currentPlayId = 0;

/** 当前语音合成请求的 AbortController（用于实时播放的单个请求） */
let currentAbortController: AbortController | null = null;

/** 预加载批次的 AbortController（用于预加载的多个并发请求） */
const preloadAbortController: AbortController | null = null;

/** 音频缓存（URL → Base64），避免重复下载 */
const audioCache = new Map<string, string>();

/** 内存缓存（文本+音色 → Blob），避免同一会话重复合成，页面刷新后清空 */
const memoryCache = new Map<string, Blob>();

/** 临时语音缓存（用于 roll 未保存的语音），不写入持久化缓存 */
const tempVoiceCache = new Map<string, Blob>();

/** 请求队列任务 */
interface QueueTask {
  id: number;
  execute: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  isRealtime: boolean;
  abortController?: AbortController;
}

/** 请求队列 */
let requestQueue: QueueTask[] = [];
let isProcessingQueue = false;
let nextTaskId = 0;
/** 当前正在执行的任务 */
let currentExecutingTask: QueueTask | null = null;

/** 预加载进行中标志 */
let isPreloading = false;

/** 处理请求队列（确保同一时间只有一个请求在执行） */
async function processQueue(): Promise<void> {
  if (isProcessingQueue || requestQueue.length === 0) {
    return;
  }

  isProcessingQueue = true;

  while (requestQueue.length > 0) {
    const task = requestQueue.shift()!;
    currentExecutingTask = task;

    try {
      const result = await task.execute();
      task.resolve(result);
    } catch (error) {
      task.reject(error);
    } finally {
      currentExecutingTask = null;
    }
  }

  isProcessingQueue = false;
}

/** 将请求加入队列 */
function enqueueRequest<T>(execute: (abortController: AbortController) => Promise<T>, isRealtime: boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    const taskId = nextTaskId++;
    const abortController = new AbortController();

    const task: QueueTask = {
      id: taskId,
      execute: () => execute(abortController),
      resolve,
      reject,
      isRealtime,
      abortController,
    };

    // 实时播放请求插入队列前面（优先处理），预加载请求排在后面
    if (isRealtime) {
      // 找到第一个非实时任务的位置
      const firstPreloadIndex = requestQueue.findIndex(t => !t.isRealtime);
      if (firstPreloadIndex === -1) {
        requestQueue.push(task);
      } else {
        requestQueue.splice(firstPreloadIndex, 0, task);
      }
    } else {
      requestQueue.push(task);
    }

    processQueue();
  });
}

/** 生成语音缓存键 */
function makeVoiceCacheKey(text: string, voice: string): string {
  return `${voice}:${text.slice(0, 200)}`;
}

/**
 * 从 URL 下载音频文件并转换为 Base64
 * @param url 音频文件的 URL
 * @returns Base64 格式的音频数据（包含 data:audio/... 前缀）
 */
async function loadAudioFromUrl(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`下载音频失败: ${url} (HTTP ${response.status})`);
    }

    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error(`[voiceService] 加载音频 URL 失败: ${url}`, error);
    throw error;
  }
}

/**
 * 解析 voice 配置（支持三种格式）
 * 1. Base64 字符串：data:audio/... → 直接返回
 * 2. HTTP/HTTPS URL → 下载并转换为 Base64
 * 3. 其他：预置音色 ID 或文本描述 → 直接返回
 *
 * @param voice 原始 voice 配置
 * @returns 解析后的 voice 值（Base64 或原值）
 */
async function resolveVoiceConfig(voice: string): Promise<string> {
  // 已经是 Base64 格式
  if (voice.startsWith('data:audio/')) {
    return voice;
  }

  // 是 URL，需要下载并转换
  if (voice.startsWith('http://') || voice.startsWith('https://')) {
    // 检查缓存
    if (audioCache.has(voice)) {
      return audioCache.get(voice)!;
    }

    // 下载并缓存
    const base64 = await loadAudioFromUrl(voice);
    audioCache.set(voice, base64);
    return base64;
  }

  // 预置音色 ID 或文本描述，直接返回
  return voice;
}

/**
 * 调用 MiMo API 合成语音
 * @param text 要合成的文本（放在 assistant 消息中）
 * @param voiceSettings 角色语音设置
 * @param config 全局语音配置
 * @param signal 可选的 AbortSignal（用于外部取消）
 * @param isRealtime 是否是实时播放（实时播放减少重试次数，避免干扰用户）
 * @returns 音频 Blob (WAV 格式)
 */
async function synthesizeVoiceWithMiMo(
  text: string,
  voiceSettings: CharacterVoiceSettings,
  config: VoiceConfig,
  externalAbortController: AbortController,
  isRealtime: boolean = false,
): Promise<Blob> {
  // 使用传入的 AbortController
  const abortController = externalAbortController;

  // 429 错误重试逻辑
  const RETRY_DELAY = 3000;
  // 实时播放时减少重试次数，避免长时间卡顿
  const MAX_RETRY_COUNT = isRealtime ? 2 : 10;
  let retryCount = 0;

  try {
    // 构建请求体（遵循 OpenAI Chat Completions 格式）
    const requestBody: any = {
      model: config.model,
      messages: [
        // user 消息：风格控制指令（可选）
        ...(voiceSettings.stylePrompt
          ? [{ role: 'user', content: voiceSettings.stylePrompt }]
          : [{ role: 'user', content: '' }]),
        // assistant 消息：要合成的文本
        { role: 'assistant', content: text },
      ],
      audio: {
        format: 'wav', // 非流式返回 WAV
        ...(config.model === 'mimo-v2.5-tts' && { voice: voiceSettings.voice }), // 预置音色
        ...(config.model === 'mimo-v2.5-tts-voiceclone' && { voice: voiceSettings.voice }), // 克隆音色（base64）
      },
    };

    while (true) {
      // 检查取消信号
      if (abortController.signal.aborted) {
        throw new Error('请求已取消');
      }

      try {
        // 创建一个带超时的 AbortController (30秒超时)
        const timeoutId = setTimeout(() => {
          console.error('[voiceService] 请求超时 (30秒)');
          abortController.abort('timeout');
        }, 30000);

        const response = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'api-key': config.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: abortController.signal,
        }).finally(() => clearTimeout(timeoutId));

        if (response.ok) {
          const result = await response.json();

          // 解析返回的 base64 音频数据
          const audioData = result.choices?.[0]?.message?.audio?.data;
          if (!audioData) {
            throw new Error('API 返回中未找到音频数据');
          }

          // 将 base64 转换为 Blob
          const binaryString = atob(audioData);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          return new Blob([bytes], { type: 'audio/wav' });
        }

        const errorText = await response.text().catch(() => '');
        console.error('[voiceService] 请求失败:', {
          status: response.status,
          statusText: response.statusText,
          errorBody: errorText.slice(0, 500),
        });

        // 429 错误：自动重试
        if (response.status === 429) {
          retryCount++;

          if (retryCount >= MAX_RETRY_COUNT) {
            throw new Error(`MiMo API 速率限制，已重试 ${retryCount} 次，请稍后再试`);
          }

          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          continue;
        }

        // 其他错误直接抛出
        throw new Error(`MiMo API 返回错误 ${response.status}: ${errorText}`);
      } catch (error) {
        // 如果是取消错误，直接抛出
        if (error instanceof Error && (error.name === 'AbortError' || abortController.signal.aborted)) {
          throw new Error('请求已取消');
        }

        // 其他错误直接抛出，不再重试
        throw error;
      }
    }
  } finally {
    // 清理完成
  }
}

/**
 * 播放语音音频
 * @param audioBlob 音频 Blob
 * @param volume 音量 0.0-1.0
 * @param playId 本次播放的唯一ID
 * @returns Promise，播放完成时 resolve
 */
function playVoiceAudio(audioBlob: Blob, volume: number, playId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // 检查是否已经是过期的播放请求
    if (playId !== currentPlayId) {
      resolve();
      return;
    }

    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = document.createElement('audio');
    audio.src = audioUrl;
    audio.volume = Math.max(0, Math.min(1, volume));

    // 加入活跃音频列表
    activeAudios.add(audio);

    // 设置为当前音频
    currentAudio = audio;

    const cleanup = () => {
      activeAudios.delete(audio);
      URL.revokeObjectURL(audioUrl);
      if (currentAudio === audio) {
        currentAudio = null;
      }
    };

    audio.onended = () => {
      cleanup();
      resolve();
    };

    audio.onerror = e => {
      cleanup();
      resolve(); // 不 reject，被中断是正常的
    };

    // 尝试播放，但在播放前再次检查ID
    if (playId !== currentPlayId) {
      cleanup();
      resolve();
      return;
    }

    audio
      .play()
      .then(() => {
        // play() 成功后立即检查ID，如果已过期立即停止
        if (playId !== currentPlayId) {
          try {
            audio.pause();
            audio.currentTime = 0;
            audio.src = '';
            audio.load(); // 强制重置
          } catch (e) {
            // 忽略错误
          }
          cleanup();
          resolve();
          return;
        }

        // 添加定期检查机制，每50ms检查一次playId是否还有效
        const checkInterval = setInterval(() => {
          if (playId !== currentPlayId) {
            clearInterval(checkInterval);
            try {
              audio.pause();
              audio.currentTime = 0;
              audio.src = '';
              audio.load();
            } catch (e) {
              // 忽略错误
            }
            cleanup();
            resolve();
          }
        }, 50);

        // 音频结束时清除定时器
        const originalOnended = audio.onended;
        audio.onended = ev => {
          clearInterval(checkInterval);
          if (originalOnended) {
            originalOnended.call(audio, ev);
          }
        };

        const originalOnerror = audio.onerror;
        audio.onerror = e => {
          clearInterval(checkInterval);
          if (originalOnerror) {
            originalOnerror.call(audio, e);
          }
        };
      })
      .catch(err => {
        // 播放失败也清理
        cleanup();
        resolve();
      });
  });
}

/**
 * 停止当前正在播放的语音
 */
export function stopCurrentVoice(): void {
  // 中止当前的合成请求
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }

  // 停止并清理所有活跃的音频元素
  if (activeAudios.size > 0) {
    const audiosToClean = Array.from(activeAudios);
    activeAudios.clear(); // 先清空集合，防止在清理过程中被修改

    audiosToClean.forEach(audio => {
      try {
        // 移除所有事件监听器，防止触发回调
        audio.onended = null;
        audio.onerror = null;
        audio.onpause = null;
        audio.onplay = null;

        // 立即暂停
        audio.pause();

        // 清空 src 并重置
        const currentSrc = audio.src;
        audio.src = '';
        audio.load();

        // 释放 Blob URL
        if (currentSrc && currentSrc.startsWith('blob:')) {
          URL.revokeObjectURL(currentSrc);
        }
      } catch (e) {
        // 忽略错误
      }
    });
  }

  // 清除当前音频引用
  currentAudio = null;
}

/**
 * 取消所有预加载任务（清空队列中的预加载任务，并中止正在执行的预加载任务）
 */
export function cancelPreloadVoice(): void {
  // 1. 中止正在执行的预加载任务
  if (currentExecutingTask && !currentExecutingTask.isRealtime) {
    currentExecutingTask.abortController?.abort();
  }

  // 2. 清空队列中的预加载任务
  requestQueue = requestQueue.filter(t => t.isRealtime);
}

/**
 * 清空所有队列任务
 */
export function clearAllVoiceTasks(): void {
  requestQueue = [];
  stopCurrentVoice();
}

/**
 * 重置预加载（已废弃，保留接口兼容性）
 */
export function resetPreloadVoice(): void {
  // 不再需要，保留空函数以兼容现有代码
}

/**
 * 合成并播放语音（一体化接口）
 * @param text 要合成的文本
 * @param voiceSettings 角色语音设置
 * @param config 全局语音配置
 * @param globalVolume 全局音量
 * @param emotionTags 情绪标签（可选）
 * @returns Promise，播放完成时 resolve
 */
export async function synthesizeAndPlayVoice(
  text: string,
  voiceSettings: CharacterVoiceSettings,
  config: VoiceConfig,
  globalVolume: number = 1.0,
  emotionTags?: { styleTag?: string; textWithInlineTags: string },
): Promise<void> {
  try {
    // 立即停止之前的所有语音操作，并生成新的播放ID
    stopCurrentVoice();
    currentPlayId++;
    const thisPlayId = currentPlayId;

    // 如果正在预加载，跳过实时播放，避免冲突导致 429
    if (isPreloading) {
      return;
    }

    // 决定发送给 TTS 的文本
    // 如果有情绪标签，使用带标签的文本；否则清理后使用原文本
    let textForTTS: string;
    if (emotionTags) {
      // 组合：段落级标签 + 内联标签文本
      textForTTS = `${emotionTags.styleTag || ''}${emotionTags.textWithInlineTags}`;
    } else {
      // 清理文本：移除内心独白标记、富文本标签、换行符
      textForTTS = text
        .replace(/\[inner\]/g, '')
        .replace(/[()（）]/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\n/g, ' ')
        .trim();
      }

    if (!textForTTS) {
      return;
    }

    // 创建新的 AbortController 用于这次请求
    currentAbortController = new AbortController();
    const thisAbortController = currentAbortController;

    // 解析 voice 配置（自动处理 URL、Base64、预置音色）
    const resolvedVoice = await resolveVoiceConfig(voiceSettings.voice);

    // 解析配置后立即检查播放ID
    if (thisPlayId !== currentPlayId) {
      return;
    }

    const resolvedSettings = { ...voiceSettings, voice: resolvedVoice };

    // 生成缓存键（包含情绪标签以区分不同情绪）
    const emotionTagStr = emotionTags ? `${emotionTags.styleTag || ''}:${emotionTags.textWithInlineTags}` : '';
    const cacheKey = makeVoiceCacheKey(textForTTS + emotionTagStr, resolvedVoice);

    // 检查播放ID是否还有效
    if (thisPlayId !== currentPlayId) {
      return;
    }

    // 检查是否被中止
    if (thisAbortController.signal.aborted) {
      return;
    }

    // 1. 先检查内存缓存（最快）
    let audioBlob: Blob | undefined = memoryCache.get(cacheKey);

    // 2. 如果内存缓存没有，检查 IndexedDB 持久化缓存
    if (!audioBlob) {
      const cachedBlob = await getVoiceAudio(cacheKey);
      if (cachedBlob) {
        audioBlob = cachedBlob;
        // 写回内存缓存
        memoryCache.set(cacheKey, cachedBlob);
      }
    }

    // 再次检查播放ID
    if (thisPlayId !== currentPlayId) {
      return;
    }

    // 再次检查是否被中止
    if (thisAbortController.signal.aborted) {
      return;
    }

    // 3. 如果都没有，调用 API 合成
    if (!audioBlob) {
      audioBlob = await synthesizeVoiceWithMiMo(textForTTS, resolvedSettings, config, thisAbortController, true);

      // 同时写入内存缓存和 IndexedDB
      memoryCache.set(cacheKey, audioBlob);
      putVoiceAudio(cacheKey, audioBlob).catch(err => {
        console.error('[voiceService] 写入 IndexedDB 失败:', err);
      });
    }

    // 最后一次检查播放ID
    if (thisPlayId !== currentPlayId) {
      return;
    }

    // 最后一次检查是否被中止
    if (thisAbortController.signal.aborted) {
      return;
    }

    // 计算最终音量：角色音量 × 全局音量
    const finalVolume = voiceSettings.volume * globalVolume;
    await playVoiceAudio(audioBlob, finalVolume, thisPlayId);

    // 播放完成后，清除 AbortController
    if (currentAbortController === thisAbortController) {
      currentAbortController = null;
    }
  } catch (error) {
    // 如果是用户取消（AbortError），不报错
    if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('已取消'))) {
      return;
    }
    console.error('[voiceService] 语音合成或播放失败:', error);
    throw error;
  }
}

/**
 * 预生成语音（不播放，仅缓存）
 * @param text 要合成的文本
 * @param voiceSettings 角色语音设置
 * @param config 全局语音配置
 * @returns Promise<boolean>，true 表示使用了缓存，false 表示新生成
 */
export async function synthesizeAndPreloadVoice(
  text: string,
  voiceSettings: CharacterVoiceSettings,
  config: VoiceConfig,
): Promise<boolean> {
  try {
    // 标记预加载开始
    isPreloading = true;

    // 清理文本
    const cleanText = text
      .replace(/\[inner\]/g, '')
      .replace(/[()（）]/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\n/g, ' ')
      .trim();

    if (!cleanText) {
      return true; // 空文本视为已缓存
    }

    // 解析 voice 配置
    const resolvedVoice = await resolveVoiceConfig(voiceSettings.voice);
    const resolvedSettings = { ...voiceSettings, voice: resolvedVoice };

    // 生成缓存键
    const cacheKey = makeVoiceCacheKey(cleanText, resolvedVoice);

    // 1. 检查内存缓存
    if (memoryCache.has(cacheKey)) {
      return true; // 使用了缓存
    }

    // 2. 检查 IndexedDB 缓存
    const cachedBlob = await getVoiceAudio(cacheKey);
    if (cachedBlob) {
      // 写回内存缓存
      memoryCache.set(cacheKey, cachedBlob);
      return true; // 使用了缓存
    }

    // 3. 通过队列执行合成请求（预加载，低优先级）
    const audioBlob = await enqueueRequest(
      abortController => synthesizeVoiceWithMiMo(cleanText, resolvedSettings, config, abortController, false),
      false, // isRealtime
    );

    // 同时写入内存缓存和 IndexedDB
    memoryCache.set(cacheKey, audioBlob);
    putVoiceAudio(cacheKey, audioBlob).catch(err => {
      console.error('[voiceService] 预加载写入 IndexedDB 失败:', err);
    });

    return false; // 新生成
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('已取消'))) {
      return false;
    }
    console.error('[voiceService] 语音预生成失败:', error);
    throw error;
  } finally {
    // 标记预加载结束
    isPreloading = false;
  }
}

/**
 * 检查 MiMo API 是否可用（验证密钥）
 * @param apiKey API 密钥
 * @returns 是否可用
 */
export async function checkMiMoAPIAvailable(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'mimo-v2.5-tts',
        messages: [
          { role: 'user', content: '' },
          { role: 'assistant', content: '测试' },
        ],
        audio: { format: 'wav', voice: '冰糖' },
      }),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 设置预加载状态（由 preloadService 调用）
 */
export function setPreloadingState(state: boolean): void {
  isPreloading = state;
}

/**
 * 获取预加载状态
 */
export function isPreloadingActive(): boolean {
  return isPreloading;
}

/**
 * 重新生成语音（不保存到缓存，存入临时缓存）
 * @param text 要合成的文本
 * @param voiceSettings 角色语音设置
 * @param config 全局语音配置
 * @param segmentId 段落ID（用于获取情绪标签缓存）
 * @param voiceConfigHash 音色配置hash（用于获取情绪标签缓存）
 * @returns 新生成的音频 Blob
 */
export async function regenerateVoice(
  text: string,
  voiceSettings: CharacterVoiceSettings,
  config: VoiceConfig,
  segmentId?: string,
  voiceConfigHash?: string,
): Promise<Blob> {
  // 检查是否启用情绪标签，以及是否存在缓存
  let emotionTags: { styleTag?: string; textWithInlineTags: string } | undefined;

  if (config.enableEmotionTags && segmentId && voiceConfigHash) {
    // 尝试从缓存获取情绪标签
    const cacheKey = makeEmotionTagCacheKey(parseInt(segmentId), voiceConfigHash);
    const cachedResult = await getEmotionTags(cacheKey);

    // 如果缓存存在，使用缓存的情绪标签
    if (cachedResult && cachedResult[segmentId]) {
      emotionTags = cachedResult[segmentId];
    } else {
    }
  }

  // 决定发送给 TTS 的文本
  let textForTTS: string;
  if (emotionTags) {
    // 组合：段落级标签 + 内联标签文本
    textForTTS = `${emotionTags.styleTag || ''}${emotionTags.textWithInlineTags}`;
  } else {
    // 清理文本
    textForTTS = text
      .replace(/\[inner\]/g, '')
      .replace(/[()（）]/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\n/g, ' ')
      .trim();
  }

  if (!textForTTS) {
    throw new Error('清理后文本为空');
  }

  // 解析 voice 配置
  const resolvedVoice = await resolveVoiceConfig(voiceSettings.voice);
  const resolvedSettings = { ...voiceSettings, voice: resolvedVoice };

  // 调用 API 重新生成（不检查缓存）
  const audioBlob = await synthesizeVoiceWithMiMo(textForTTS, resolvedSettings, config, new AbortController(), true);

  // 存入临时缓存（缓存键需要包含情绪标签信息）
  const emotionTagStr = emotionTags ? `${emotionTags.styleTag || ''}:${emotionTags.textWithInlineTags}` : '';
  const cacheKey = makeVoiceCacheKey(textForTTS + emotionTagStr, resolvedVoice);
  tempVoiceCache.set(cacheKey, audioBlob);

  return audioBlob;
}

/**
 * 保存临时语音到持久化缓存（覆盖旧缓存）
 * @param text 文本
 * @param voice 音色
 */
export async function saveTempVoice(text: string, voice: string): Promise<void> {
  // 清理文本
  const cleanText = text
    .replace(/\[inner\]/g, '')
    .replace(/[()（）]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n/g, ' ')
    .trim();

  const resolvedVoice = await resolveVoiceConfig(voice);
  const cacheKey = makeVoiceCacheKey(cleanText, resolvedVoice);

  // 从临时缓存获取
  const audioBlob = tempVoiceCache.get(cacheKey);
  if (!audioBlob) {
    console.warn('[voiceService] 临时缓存中没有找到语音，无法保存');
    return;
  }

  // 写入内存缓存和 IndexedDB（覆盖旧数据）
  memoryCache.set(cacheKey, audioBlob);
  await putVoiceAudio(cacheKey, audioBlob);

  // 清除临时缓存
  tempVoiceCache.delete(cacheKey);
}

/**
 * 取消临时语音（清除临时缓存）
 * @param text 文本
 * @param voice 音色
 */
export async function cancelTempVoice(text: string, voice: string): Promise<void> {
  const cleanText = text
    .replace(/\[inner\]/g, '')
    .replace(/[()（）]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n/g, ' ')
    .trim();

  const resolvedVoice = await resolveVoiceConfig(voice);
  const cacheKey = makeVoiceCacheKey(cleanText, resolvedVoice);

  tempVoiceCache.delete(cacheKey);
}

/**
 * 清空所有临时语音缓存（用于段落切换时防止缓存污染）
 * 同时停止所有正在播放的音频，防止切换时的语音混乱
 */
export function clearAllTempVoiceCache(): void {
  tempVoiceCache.clear();
  // 停止所有正在播放的语音，防止切换段落时出现多条语音同时播放
  stopCurrentVoice();
}

/**
 * 手动播放语音（优先播放临时缓存，其次持久化缓存）
 * @param text 文本
 * @param voiceSettings 角色语音设置
 * @param config 全局语音配置
 * @param globalVolume 全局音量
 */
export async function manualPlayVoice(
  text: string,
  voiceSettings: CharacterVoiceSettings,
  config: VoiceConfig,
  globalVolume: number = 1.0,
): Promise<void> {
  // 停止之前的播放并生成新的 playId
  stopCurrentVoice();
  currentPlayId++;
  const thisPlayId = currentPlayId;

  // 清理文本
  const cleanText = text
    .replace(/\[inner\]/g, '')
    .replace(/[()（）]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n/g, ' ')
    .trim();

  if (!cleanText) {
    console.warn('[voiceService] 清理后文本为空，跳过播放');
    return;
  }

  const resolvedVoice = await resolveVoiceConfig(voiceSettings.voice);
  const cacheKey = makeVoiceCacheKey(cleanText, resolvedVoice);

  // 检查是否被取消
  if (thisPlayId !== currentPlayId) {
    return;
  }

  // 1. 优先从临时缓存获取（roll 的语音）
  let audioBlob = tempVoiceCache.get(cacheKey);

  // 2. 其次从内存缓存获取
  if (!audioBlob) {
    audioBlob = memoryCache.get(cacheKey);
  }

  // 3. 最后从 IndexedDB 获取
  if (!audioBlob) {
    const cachedBlob = await getVoiceAudio(cacheKey);
    if (cachedBlob) {
      audioBlob = cachedBlob;
      memoryCache.set(cacheKey, cachedBlob);
    }
  }

  // 再次检查是否被取消
  if (thisPlayId !== currentPlayId) {
    return;
  }

  // 4. 如果都没有，提示用户
  if (!audioBlob) {
    console.warn('[voiceService] 未找到缓存的语音');
    return;
  }

  // 播放
  const finalVolume = voiceSettings.volume * globalVolume;
  await playVoiceAudio(audioBlob, finalVolume, thisPlayId);
}
