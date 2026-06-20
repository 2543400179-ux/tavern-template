/**
 * Preload Service - Preload CG, Voice, Background and Character Sprite resources
 */

import { parseDialogueScript } from '../parser';
import { preloadImage } from '../resourceLoader';
import type { DialogueSegment, ResourceConfig } from '../types';
import { getCGImage, makeRangeCacheKey } from './cgCache';
import { getCGForRange, loadCGRangeRecipeBundle, loadCGSettings, triggerCGGenerationWithRange } from './cgTaskManager';
import { setPreloadingState, synthesizeAndPreloadVoice } from './voiceService';

export interface PreloadProgress {
  phase: 'idle' | 'checking' | 'resources' | 'cg' | 'voice' | 'done' | 'error';
  cgTotal: number;
  cgCompleted: number;
  cgCached: number;
  voiceTotal: number;
  voiceCompleted: number;
  voiceCached: number;
  bgTotal: number;
  bgCompleted: number;
  bgCached: number;
  spriteTotal: number;
  spriteCompleted: number;
  spriteCached: number;
  currentTask?: string;
  error?: string;
}

type ProgressCallback = (progress: PreloadProgress) => void;

const progressListeners: Set<ProgressCallback> = new Set();
let currentProgress: PreloadProgress = {
  phase: 'idle',
  cgTotal: 0,
  cgCompleted: 0,
  cgCached: 0,
  voiceTotal: 0,
  voiceCompleted: 0,
  voiceCached: 0,
  bgTotal: 0,
  bgCompleted: 0,
  bgCached: 0,
  spriteTotal: 0,
  spriteCompleted: 0,
  spriteCached: 0,
};

function notifyProgress(progress: PreloadProgress) {
  currentProgress = progress;
  for (const listener of progressListeners) {
    try {
      listener(progress);
    } catch (e) {
      console.error('[preloadService] Progress callback error:', e);
    }
  }
}

export function onPreloadProgress(callback: ProgressCallback): () => void {
  progressListeners.add(callback);
  callback(currentProgress);
  return () => progressListeners.delete(callback);
}

export function getPreloadProgress(): PreloadProgress {
  return currentProgress;
}

/**
 * 从段落中提取所有需要的背景和立绘资源
 */
function extractResourceUrls(
  segments: DialogueSegment[],
  resourceConfig: ResourceConfig,
): {
  backgrounds: Set<string>;
  sprites: Set<string>;
} {
  const backgrounds = new Set<string>();
  const sprites = new Set<string>();

  // 解析背景图（优先 bgKey，其次 bgName）
  const resolveBg = (bgName: string, bgKey?: string): string => {
    if (bgKey && resourceConfig.backgrounds[bgKey]) return resourceConfig.backgrounds[bgKey];
    if (bgName && resourceConfig.backgrounds[bgName]) return resourceConfig.backgrounds[bgName];
    return '';
  };

  // 解析角色立绘
  const resolveChar = (charName: string, face?: string): string => {
    const charImages = resourceConfig.characters[charName];
    if (!charImages) return '';
    if (face && charImages[face]) return charImages[face];
    if (charImages['默认']) return charImages['默认'];
    if (charImages['default']) return charImages['default'];
    const keys = Object.keys(charImages);
    return keys.length > 0 ? charImages[keys[0]] : '';
  };

  // 累积状态，用于正确解析每个段落的实际资源
  let currentChar = '';
  let currentAbout = '';
  let currentFace = '';

  for (const seg of segments) {
    const eff = seg.effects;

    // 背景
    if (eff.bg) {
      const bgUrl = resolveBg(eff.bg, eff.bgKey);
      if (bgUrl) backgrounds.add(bgUrl);
    }

    // CG（也算作背景资源）
    if (eff.cg && resourceConfig.cg[eff.cg]) {
      backgrounds.add(resourceConfig.cg[eff.cg]);
    }

    // 角色立绘（累积计算）
    if (eff.char) {
      currentChar = eff.char;
      currentAbout = '';
      currentFace = '';
    }
    if (eff.about) {
      currentAbout = eff.about;
      currentFace = '';
    }
    if (eff.face) {
      currentFace = eff.face;
    }

    const spriteChar = currentAbout || currentChar;
    if (spriteChar) {
      const spriteUrl = resolveChar(spriteChar, currentFace);
      if (spriteUrl) sprites.add(spriteUrl);
    }
  }

  return { backgrounds, sprites };
}
export async function preloadFloorResources(
  segments: DialogueSegment[],
  messageId: number,
  resourceConfig: ResourceConfig,
  characterAppearances?: Record<string, string>,
  cgPreloadEnabled?: boolean,
  voicePreloadEnabled?: boolean,
): Promise<boolean> {
  try {
    notifyProgress({
      phase: 'checking',
      cgTotal: 0,
      cgCompleted: 0,
      cgCached: 0,
      voiceTotal: 0,
      voiceCompleted: 0,
      voiceCached: 0,
      bgTotal: 0,
      bgCompleted: 0,
      bgCached: 0,
      spriteTotal: 0,
      spriteCompleted: 0,
      spriteCached: 0,
      currentTask: '正在检查已有资源...',
    });

    const paragraphs = segments.map(seg => seg.text);
    const cgSettings = loadCGSettings();
    const voiceConfig = resourceConfig.voices;

    // ====== 阶段 1: 预加载背景和立绘资源 ======
    const { backgrounds, sprites } = extractResourceUrls(segments, resourceConfig);
    const bgArray = Array.from(backgrounds);
    const spriteArray = Array.from(sprites);

    let bgCachedCount = 0;
    let spriteCachedCount = 0;

    // 检查哪些资源已经缓存
    if (!preloadImage.cache) {
      preloadImage.cache = new Map();
    }
    const imageCache = preloadImage.cache;

    for (const url of bgArray) {
      if (imageCache.has(url)) bgCachedCount++;
    }
    for (const url of spriteArray) {
      if (imageCache.has(url)) spriteCachedCount++;
    }

    if (bgArray.length > 0 || spriteArray.length > 0) {
      notifyProgress({
        phase: 'resources',
        cgTotal: 0,
        cgCompleted: 0,
        cgCached: 0,
        voiceTotal: 0,
        voiceCompleted: 0,
        voiceCached: 0,
        bgTotal: bgArray.length,
        bgCompleted: 0,
        bgCached: bgCachedCount,
        spriteTotal: spriteArray.length,
        spriteCompleted: 0,
        spriteCached: spriteCachedCount,
        currentTask: `正在加载背景图和立绘资源... (背景 ${bgCachedCount}/${bgArray.length} 已缓存, 立绘 ${spriteCachedCount}/${spriteArray.length} 已缓存)`,
      });

      // 预加载背景
      for (let i = 0; i < bgArray.length; i++) {
        const url = bgArray[i];
        if (!imageCache.has(url)) {
          notifyProgress({
            phase: 'resources',
            cgTotal: 0,
            cgCompleted: 0,
            cgCached: 0,
            voiceTotal: 0,
            voiceCompleted: 0,
            voiceCached: 0,
            bgTotal: bgArray.length,
            bgCompleted: i,
            bgCached: bgCachedCount,
            spriteTotal: spriteArray.length,
            spriteCompleted: 0,
            spriteCached: spriteCachedCount,
            currentTask: `正在加载背景图 ${i + 1}/${bgArray.length}...`,
          });

          try {
            await preloadImage(url);
          } catch (e) {
            console.warn(`[preloadService] 背景图加载失败 (${i + 1}/${bgArray.length}):`, e);
          }
        }
      }

      notifyProgress({
        phase: 'resources',
        cgTotal: 0,
        cgCompleted: 0,
        cgCached: 0,
        voiceTotal: 0,
        voiceCompleted: 0,
        voiceCached: 0,
        bgTotal: bgArray.length,
        bgCompleted: bgArray.length,
        bgCached: bgCachedCount,
        spriteTotal: spriteArray.length,
        spriteCompleted: 0,
        spriteCached: spriteCachedCount,
        currentTask: `背景图加载完成 (${bgCachedCount} 已缓存, ${bgArray.length - bgCachedCount} 新加载)`,
      });

      // 预加载立绘
      for (let i = 0; i < spriteArray.length; i++) {
        const url = spriteArray[i];
        if (!imageCache.has(url)) {
          notifyProgress({
            phase: 'resources',
            cgTotal: 0,
            cgCompleted: 0,
            cgCached: 0,
            voiceTotal: 0,
            voiceCompleted: 0,
            voiceCached: 0,
            bgTotal: bgArray.length,
            bgCompleted: bgArray.length,
            bgCached: bgCachedCount,
            spriteTotal: spriteArray.length,
            spriteCompleted: i,
            spriteCached: spriteCachedCount,
            currentTask: `正在加载立绘 ${i + 1}/${spriteArray.length}...`,
          });

          try {
            await preloadImage(url);
          } catch (e) {
            console.warn(`[preloadService] 立绘加载失败 (${i + 1}/${spriteArray.length}):`, e);
          }
        }
      }

      notifyProgress({
        phase: 'resources',
        cgTotal: 0,
        cgCompleted: 0,
        cgCached: 0,
        voiceTotal: 0,
        voiceCompleted: 0,
        voiceCached: 0,
        bgTotal: bgArray.length,
        bgCompleted: bgArray.length,
        bgCached: bgCachedCount,
        spriteTotal: spriteArray.length,
        spriteCompleted: spriteArray.length,
        spriteCached: spriteCachedCount,
        currentTask: `立绘加载完成 (${spriteCachedCount} 已缓存, ${spriteArray.length - spriteCachedCount} 新加载)`,
      });
    }
    // ====== 阶段 2: 预加载 CG ======
    let cgSuccess = true;
    let cgCachedCount = 0;

    if (cgPreloadEnabled && cgSettings.enabled && cgSettings.directorLLM.apiKey && cgSettings.novelAI.apiKey) {
      const existingBundle = loadCGRangeRecipeBundle(messageId);

      if (existingBundle && existingBundle.ranges.length > 0) {
        const ranges = existingBundle.ranges;
        const missingRanges: Array<{ startIndex: number; endIndex: number }> = [];

        for (const range of ranges) {
          const cacheKey = makeRangeCacheKey(messageId, range.startIndex, range.endIndex);
          const cached = await getCGImage(cacheKey);
          if (cached) {
            cgCachedCount++;
          } else {
            missingRanges.push({ startIndex: range.startIndex, endIndex: range.endIndex });
          }
        }

        notifyProgress({
          phase: 'cg',
          cgTotal: ranges.length,
          cgCompleted: 0,
          cgCached: cgCachedCount,
          voiceTotal: 0,
          voiceCompleted: 0,
          voiceCached: 0,
          bgTotal: bgArray.length,
          bgCompleted: bgArray.length,
          bgCached: bgCachedCount,
          spriteTotal: spriteArray.length,
          spriteCompleted: spriteArray.length,
          spriteCached: spriteCachedCount,
          currentTask: `已缓存 ${cgCachedCount}/${ranges.length} CG${missingRanges.length > 0 ? `，正在重绘 ${missingRanges.length} 张...` : ''}`,
        });

        if (missingRanges.length > 0) {
          for (let i = 0; i < missingRanges.length; i++) {
            const range = missingRanges[i];
            notifyProgress({
              phase: 'cg',
              cgTotal: ranges.length,
              cgCompleted: cgCachedCount + i,
              cgCached: cgCachedCount,
              voiceTotal: 0,
              voiceCompleted: 0,
              voiceCached: 0,
              bgTotal: bgArray.length,
              bgCompleted: bgArray.length,
              bgCached: bgCachedCount,
              spriteTotal: spriteArray.length,
              spriteCompleted: spriteArray.length,
              spriteCached: spriteCachedCount,
              currentTask: `正在重绘 CG ${cgCachedCount + i + 1}/${ranges.length}（段落 ${range.startIndex}-${range.endIndex}）`,
            });

            try {
              await getCGForRange(messageId, range.startIndex, range.endIndex);
            } catch (e) {
              console.warn(`[preloadService] CG 重绘失败 (${range.startIndex}-${range.endIndex}):`, e);
            }
          }
        }
      } else {
        notifyProgress({
          phase: 'cg',
          cgTotal: 0,
          cgCompleted: 0,
          cgCached: 0,
          voiceTotal: 0,
          voiceCompleted: 0,
          voiceCached: 0,
          bgTotal: bgArray.length,
          bgCompleted: bgArray.length,
          bgCached: bgCachedCount,
          spriteTotal: spriteArray.length,
          spriteCompleted: spriteArray.length,
          spriteCached: spriteCachedCount,
          currentTask: '首次生成，正在分析并绘制 CG...',
        });

        try {
          const ranges = await triggerCGGenerationWithRange(paragraphs, messageId, characterAppearances, false);

          notifyProgress({
            phase: 'cg',
            cgTotal: ranges.length,
            cgCompleted: ranges.length,
            cgCached: 0,
            voiceTotal: 0,
            voiceCompleted: 0,
            voiceCached: 0,
            bgTotal: bgArray.length,
            bgCompleted: bgArray.length,
            bgCached: bgCachedCount,
            spriteTotal: spriteArray.length,
            spriteCompleted: spriteArray.length,
            spriteCached: spriteCachedCount,
            currentTask: `首次生成完成，已绘制 ${ranges.length} 张 CG`,
          });
        } catch (e) {
          console.warn('[preloadService] CG 生成失败:', e);
          cgSuccess = false;
        }
      }
    }

    // 根据是否启用预加载来决定是否计算 CG 总数
    const cgBundle = cgPreloadEnabled ? loadCGRangeRecipeBundle(messageId) : null;
    const finalCgTotal = cgBundle?.ranges.length ?? 0;
    // ====== 阶段 3: 预加载语音 ======
    let voiceCachedCount = 0;
    let voiceTasks: Array<{ speaker: string; text: string }> = [];

    if (voicePreloadEnabled && voiceConfig?.enabled && voiceConfig.apiKey && voiceConfig.characterVoices) {
      setPreloadingState(true);
      cons;
      for (const seg of segments) {
        if (seg.speaker !== '旁白' && voiceConfig.characterVoices[seg.speaker]) {
          const ttsText = seg.textJa || seg.text;
          if (ttsText && ttsText.trim()) {
            voiceTasks.push({ speaker: seg.speaker, text: ttsText });
          }
        }
      }

      if (voiceTasks.length === 0) {
        // 无语音任务
      } else {
        notifyProgress({
          phase: 'voice',
          cgTotal: cgPreloadEnabled ? finalCgTotal : 0,
          cgCompleted: cgPreloadEnabled ? finalCgTotal : 0,
          cgCached: cgPreloadEnabled ? cgCachedCount : 0,
          voiceTotal: voiceTasks.length,
          voiceCompleted: 0,
          voiceCached: 0,
          bgTotal: bgArray.length,
          bgCompleted: bgArray.length,
          bgCached: bgCachedCount,
          spriteTotal: spriteArray.length,
          spriteCompleted: spriteArray.length,
          spriteCached: spriteCachedCount,
          currentTask: `准备生成 ${voiceTasks.length} 条语音...`,
        });

        for (let i = 0; i < voiceTasks.length; i++) {
          const task = voiceTasks[i];
          const voiceSettings = voiceConfig.characterVoices[task.speaker];

          notifyProgress({
            phase: 'voice',
            cgTotal: cgPreloadEnabled ? finalCgTotal : 0,
            cgCompleted: cgPreloadEnabled ? finalCgTotal : 0,
            cgCached: cgPreloadEnabled ? cgCachedCount : 0,
            voiceTotal: voiceTasks.length,
            voiceCompleted: i,
            voiceCached: voiceCachedCount,
            bgTotal: bgArray.length,
            bgCompleted: bgArray.length,
            bgCached: bgCachedCount,
            spriteTotal: spriteArray.length,
            spriteCompleted: spriteArray.length,
            spriteCached: spriteCachedCount,
            currentTask: `正在生成语音 ${i + 1}/${voiceTasks.length}（${task.speaker}）`,
          });

          let retryCount = 0;
          const MAX_OUTER_RETRIES = 3;
          let success = false;

          while (!success && retryCount < MAX_OUTER_RETRIES) {
            try {
              const usedCache = await synthesizeAndPreloadVoice(task.text, voiceSettings, voiceConfig);

              if (usedCache) {
                voiceCachedCount++;
              }

              success = true;

              if (i < voiceTasks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 5000)); // 增加到 5 秒
              }
            } catch (e) {
              retryCount++;
              const errorMsg = e instanceof Error ? e.message : String(e);

              if (errorMsg.includes('429') || errorMsg.includes('rate limit')) {
                if (retryCount >= MAX_OUTER_RETRIES) {
                  console.error(`[preloadService] 语音 ${i + 1} 达到最大重试次数 (${MAX_OUTER_RETRIES})，跳过`);
                  break;
                }

                console.warn(
                  `[preloadService] 语音 ${i + 1} 触发速率限制，等待 10 秒（重试 ${retryCount}/${MAX_OUTER_RETRIES}）...`,
                );

                notifyProgress({
                  phase: 'voice',
                  cgTotal: cgPreloadEnabled ? finalCgTotal : 0,
                  cgCompleted: cgPreloadEnabled ? finalCgTotal : 0,
                  cgCached: cgPreloadEnabled ? cgCachedCount : 0,
                  voiceTotal: voiceTasks.length,
                  voiceCompleted: i,
                  voiceCached: voiceCachedCount,
                  bgTotal: bgArray.length,
                  bgCompleted: bgArray.length,
                  bgCached: bgCachedCount,
                  spriteTotal: spriteArray.length,
                  spriteCompleted: spriteArray.length,
                  spriteCached: spriteCachedCount,
                  currentTask: `触发速率限制，等待 10 秒重试 ${i + 1}/${voiceTasks.length}（${retryCount}/${MAX_OUTER_RETRIES}）`,
                });

                await new Promise(resolve => setTimeout(resolve, 10000));
              } else {
                if (retryCount >= MAX_OUTER_RETRIES) {
                  console.error(`[preloadService] 语音 ${i + 1} 达到最大重试次数 (${MAX_OUTER_RETRIES})，跳过`);
                  break;
                }

                console.error(`[preloadService] 语音 ${i + 1} 生成失败:`, errorMsg);

                notifyProgress({
                  phase: 'voice',
                  cgTotal: cgPreloadEnabled ? finalCgTotal : 0,
                  cgCompleted: cgPreloadEnabled ? finalCgTotal : 0,
                  cgCached: cgPreloadEnabled ? cgCachedCount : 0,
                  voiceTotal: voiceTasks.length,
                  voiceCompleted: i,
                  voiceCached: voiceCachedCount,
                  bgTotal: bgArray.length,
                  bgCompleted: bgArray.length,
                  bgCached: bgCachedCount,
                  spriteTotal: spriteArray.length,
                  spriteCompleted: spriteArray.length,
                  spriteCached: spriteCachedCount,
                  currentTask: `生成失败，等待 5 秒重试 ${i + 1}/${voiceTasks.length}（${retryCount}/${MAX_OUTER_RETRIES}）`,
                });

                await new Promise(resolve => setTimeout(resolve, 5000));
              }
            }
          }

          if (!success) {
            console.warn(`[preloadService] 语音 ${i + 1} 最终失败，跳过`);
          }
        }

        notifyProgress({
          phase: 'voice',
          cgTotal: cgPreloadEnabled ? finalCgTotal : 0,
          cgCompleted: cgPreloadEnabled ? finalCgTotal : 0,
          cgCached: cgPreloadEnabled ? cgCachedCount : 0,
          voiceTotal: voiceTasks.length,
          voiceCompleted: voiceTasks.length,
          voiceCached: voiceCachedCount,
          bgTotal: bgArray.length,
          bgCompleted: bgArray.length,
          bgCached: bgCachedCount,
          spriteTotal: spriteArray.length,
          spriteCompleted: spriteArray.length,
          spriteCached: spriteCachedCount,
          currentTask: `语音就绪（${voiceCachedCount} 已缓存，${voiceTasks.length - voiceCachedCount} 新生成）`,
        });
      }

      setPreloadingState(false);
    }

    // 最终统计：只显示已启用的预加载类型
    notifyProgress({
      phase: 'done',
      cgTotal: cgPreloadEnabled ? finalCgTotal : 0,
      cgCompleted: cgPreloadEnabled ? finalCgTotal : 0,
      cgCached: cgPreloadEnabled ? cgCachedCount : 0,
      voiceTotal: voicePreloadEnabled ? voiceTasks.length : 0,
      voiceCompleted: voicePreloadEnabled ? voiceTasks.length : 0,
      voiceCached: voicePreloadEnabled ? voiceCachedCount : 0,
      bgTotal: bgArray.length,
      bgCompleted: bgArray.length,
      bgCached: bgCachedCount,
      spriteTotal: spriteArray.length,
      spriteCompleted: spriteArray.length,
      spriteCached: spriteCachedCount,
      currentTask: '加载完成！开始您的旅程吧～',
    });

    return cgSuccess;
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error('[preloadService] 预加载失败:', errorMsg);

    setPreloadingState(false);

    notifyProgress({
      phase: 'error',
      cgTotal: 0,
      cgCompleted: 0,
      cgCached: 0,
      voiceTotal: 0,
      voiceCompleted: 0,
      voiceCached: 0,
      bgTotal: 0,
      bgCompleted: 0,
      bgCached: 0,
      spriteTotal: 0,
      spriteCompleted: 0,
      spriteCached: 0,
      error: errorMsg,
    });

    return false;
  }
}

export function cancelPreload(): void {
  notifyProgress({
    phase: 'idle',
    cgTotal: 0,
    cgCompleted: 0,
    cgCached: 0,
    voiceTotal: 0,
    voiceCompleted: 0,
    voiceCached: 0,
    bgTotal: 0,
    bgCompleted: 0,
    bgCached: 0,
    spriteTotal: 0,
    spriteCompleted: 0,
    spriteCached: 0,
  });
}

export async function startPreload(
  resourceConfig: ResourceConfig,
  cgPreloadEnabled?: boolean,
  voicePreloadEnabled?: boolean,
): Promise<boolean> {
  try {
    if (typeof (window as any).getChatMessages !== 'function') {
      console.error('[preloadService] getChatMessages 函数不可用');
      throw new Error('getChatMessages 函数不可用');
    }

    if (typeof (window as any).getCurrentMessageId !== 'function') {
      console.error('[preloadService] getCurrentMessageId 函数不可用');
      throw new Error('getCurrentMessageId 函数不可用');
    }

    const getChatMessages = (window as any).getChatMessages;
    const getCurrentMessageId = (window as any).getCurrentMessageId;

    const messageId = getCurrentMessageId();

    if (messageId < 0) {
      console.warn('[preloadService] 无法获取当前消息 ID，跳过预加载');
      return false;
    }

    const messages = getChatMessages(messageId);

    if (messages.length === 0) {
      console.warn('[preloadService] 当前消息未找到，跳过预加载');
      return false;
    }

    const result = parseDialogueScript(messages[0].message);

    if (result.segments.length === 0) {
      console.warn('[preloadService] 无有效段落，跳过预加载');
      return false;
    }

    console.info(`[preloadService] 开始预加载消息 ${messageId}，共 ${result.segments.length} 个段落`);

    return await preloadFloorResources(
      result.segments,
      messageId,
      resourceConfig,
      resourceConfig.characterAppearances,
      cgPreloadEnabled,
      voicePreloadEnabled,
    );
  } catch (e) {
    console.error('[preloadService] 预加载启动失败:', e);
    notifyProgress({
      phase: 'error',
      cgTotal: 0,
      cgCompleted: 0,
      cgCached: 0,
      voiceTotal: 0,
      voiceCompleted: 0,
      voiceCached: 0,
      bgTotal: 0,
      bgCompleted: 0,
      bgCached: 0,
      spriteTotal: 0,
      spriteCompleted: 0,
      spriteCached: 0,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}
