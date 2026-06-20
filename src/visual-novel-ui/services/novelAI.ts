/**
 * NovelAI 图像生成服务
 * 负责调用 NovelAI API 生成图片，处理返回的 zip 数据，提取 base64 图片和 seed
 */

import type { NovelAIConfig, VibeEntry } from '../types';
import { addPromptToMetadata } from './pngMetadata';

const NOVELAI_API_URL = 'https://image.novelai.net/ai/generate-image';

/** NovelAI 生成结果 */
export interface NovelAIGenerateResult {
  base64: string; // 生成图片的 base64 编码
  seed: number; // 使用的随机种子
}

/**
 * 生成随机种子
 */
function generateRandomSeed(): number {
  return Math.floor(Math.random() * 4294967295);
}

/**
 * 从 zip 数据中提取 PNG 图片的 base64
 * NovelAI 返回的是一个 zip 文件，里面包含生成的 PNG 图片
 */
async function extractImageFromZip(zipData: ArrayBuffer): Promise<string> {
  // NovelAI 返回的是一个 zip 文件，里面包含生成的图片（PNG 或 WebP）
  // ZIP 中的文件数据可能是 DEFLATE 压缩的，需要解压
  const view = new DataView(zipData);

  if (zipData.byteLength < 30) {
    throw new Error('zip 数据太小');
  }

  // ZIP local file header signature: 0x04034b50
  const signature = view.getUint32(0, true);
  if (signature !== 0x04034b50) {
    throw new Error('无效的 zip 文件签名');
  }

  // 解析 local file header
  const compressionMethod = view.getUint16(8, true); // 0=stored, 8=deflate
  const generalPurposeFlag = view.getUint16(6, true);
  let compressedSize = view.getUint32(18, true);
  const fileNameLength = view.getUint16(26, true);
  const extraFieldLength = view.getUint16(28, true);

  // 获取文件名
  const fileNameBytes = new Uint8Array(zipData, 30, fileNameLength);
  const fileName = String.fromCharCode(...fileNameBytes);

  // 文件数据起始位置
  const dataOffset = 30 + fileNameLength + extraFieldLength;

  // If compressedSize is 0 and data descriptor flag (bit 3) is set,
  // need to read actual size from data descriptor, or find next local file header / central directory
  if (compressedSize === 0) {
    // Only log warning once per session to avoid log spam
    if (!globalThis.__novelai_zip_warning_logged) {
      console.warn('[novelAI] ZIP compressedSize is 0, searching for actual size');
      globalThis.__novelai_zip_warning_logged = true;
    }
    // Search for next PK signature (50 4B) or data descriptor signature (50 4B 07 08)
    for (let i = dataOffset; i < zipData.byteLength - 4; i++) {
      if (view.getUint8(i) === 0x50 && view.getUint8(i + 1) === 0x4b) {
        const nextSig = view.getUint16(i + 2, true);
        // 0x0403 = local file header, 0x0201 = central directory, 0x0807 = data descriptor
        if (nextSig === 0x0403 || nextSig === 0x0201) {
          compressedSize = i - dataOffset;
          break;
        }
        if (nextSig === 0x0807) {
          // data descriptor: skip signature (4) + crc32 (4), then read compressed size
          compressedSize = view.getUint32(i + 8, true);
          break;
        }
      }
    }
    if (compressedSize === 0) {
      compressedSize = zipData.byteLength - dataOffset;
    }
  }

  const compressedData = new Uint8Array(zipData, dataOffset, Math.min(compressedSize, zipData.byteLength - dataOffset));

  // 解压数据
  let fileData: Uint8Array;
  if (compressionMethod === 8) {
    // DEFLATE 压缩，使用 DecompressionStream API 解压
    const blob = new Blob([compressedData]);
    const ds = new DecompressionStream('deflate-raw');
    const decompressedStream = blob.stream().pipeThrough(ds);
    const decompressedBlob = await new Response(decompressedStream).blob();
    const arrayBuffer = await decompressedBlob.arrayBuffer();
    fileData = new Uint8Array(arrayBuffer);
  } else {
    // 未压缩（stored），创建一个新的 Uint8Array 副本以确保类型兼容
    fileData = new Uint8Array(compressedData);
  }

  // 根据文件名或文件头判断 MIME 类型
  let mimeType = 'image/png';
  if (
    fileName.endsWith('.webp') ||
    (fileData[0] === 0x52 && fileData[1] === 0x49 && fileData[2] === 0x46 && fileData[3] === 0x46)
  ) {
    mimeType = 'image/webp';
  } else if (
    fileName.endsWith('.jpg') ||
    fileName.endsWith('.jpeg') ||
    (fileData[0] === 0xff && fileData[1] === 0xd8)
  ) {
    mimeType = 'image/jpeg';
  } else if (fileData[0] === 0x89 && fileData[1] === 0x50 && fileData[2] === 0x4e && fileData[3] === 0x47) {
    mimeType = 'image/png';
  }

  // 转换为 base64 - 使用 Blob 和 FileReader API 避免编码问题
  // @ts-expect-error - Uint8Array 是 BlobPart 的有效类型，TypeScript 类型检查过于严格
  const blob = new Blob([fileData], { type: mimeType });
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  return base64;
}

/**
 * 调用 NovelAI API 生成图片
 * @param prompt 正向提示词（导演 LLM 生成的场景 tags）
 * @param config NovelAI 配置
 * @param seed 可选的指定种子（用于重绘）
 * @param vibes Vibe 条目
 * @param characterCaptions 角色描述列表（NovelAI V4 专用）
 * @param signal 中止信号
 * @returns 生成结果（base64 图片和种子）
 */
export async function generateImage(
  prompt: string,
  config: NovelAIConfig,
  seed?: number,
  vibes?: VibeEntry[],
  signal?: AbortSignal,
  characterCaptions?: Array<{ char_caption: string; centers: Array<{ x: number; y: number }> }>,
): Promise<NovelAIGenerateResult> {
  if (!config.apiKey) {
    throw new Error('NovelAI API Key 未配置');
  }

  const usedSeed = seed ?? generateRandomSeed();

  // 合并全局正向提示词和导演生成的 tags
  const finalPrompt = config.positivePrompt ? `${config.positivePrompt}, ${prompt}` : prompt;

  const modelName = config.model || 'nai-diffusion-4-5-full';
  const isV4Model = modelName.includes('nai-diffusion-4');

  // 处理 Vibe 参数：支持图片模式（imageBase64）和编码模式（encoding）
  const vibeImages =
    vibes && vibes.length > 0
      ? vibes.map(v => {
          // 优先使用 encoding（来自 .naiv4vibebundle）
          if (v.encoding) {
            return v.encoding;
          }

          // 否则使用 imageBase64（来自 .naidata）
          const base64 = v.imageBase64;
          if (!base64 || base64.trim() === '') {
            return '';
          }
          // 如果包含 data URL 前缀，提取纯 base64 部分
          const match = base64.match(/^data:image\/[^;]+;base64,(.+)$/);
          const pureBase64 = match ? match[1] : base64;
          return pureBase64;
        })
      : [];

  // 过滤掉空的 Vibe 数据
  const validVibeImages = vibeImages.filter(img => img && img.trim() !== '');

  // V4/V4.5 模型需要 v4_prompt 参数格式
  const parameters: Record<string, any> = {
    params_version: 3,
    width: config.resolution.width,
    height: config.resolution.height,
    scale: config.scale ?? (isV4Model ? 6 : 5),
    // V4 模型强制使用 k_euler_ancestral，忽略配置中的 sampler
    sampler: isV4Model ? 'k_euler_ancestral' : (config.sampler ?? 'k_euler'),
    steps: config.steps ?? 28,
    n_samples: 1,
    ucPreset: 0,
    qualityToggle: true,
    seed: usedSeed,
    reference_image_multiple: validVibeImages,
    reference_information_extracted_multiple:
      validVibeImages.length > 0 && vibes ? vibes.slice(0, validVibeImages.length).map(v => v.infoExtracted) : [],
    reference_strength_multiple:
      validVibeImages.length > 0 && vibes ? vibes.slice(0, validVibeImages.length).map(v => v.strength) : [],
    deliberate_euler_ancestral_bug: false,
    prefer_brownian: true,
  };

  // V4/V4.5 模型需要额外的 v4_prompt 和 v4_negative_prompt 参数
  if (isV4Model) {
    parameters.use_coords = false;
    parameters.legacy_v3_extend = false;
    parameters.cfg_rescale = 0;
    parameters.noise_schedule = 'karras';
    parameters.skip_cfg_above_sigma = null;
    parameters.uncond_scale = 1;
    parameters.controlnet_strength = 1;
    parameters.controlnet_model = null;
    parameters.dynamic_thresholding = false;
    parameters.dynamic_thresholding_percentile = 0.999;
    parameters.dynamic_thresholding_mimic_scale = 10;
    parameters.sm = false;
    parameters.sm_dyn = false;
    parameters.skip_cfg_below_sigma = 0;
    parameters.lora_unet_weights = null;
    parameters.lora_clip_weights = null;
    parameters.cfg_sched_eligibility = 'enable_for_post_summer_samplers';
    parameters.explike_fine_detail = false;
    parameters.minimize_sigma_inf = false;
    parameters.add_original_image = false;
    parameters.uncond_per_vibe = true;
    parameters.wonky_vibe_correlation = true;
    parameters.stream = 'msgpack';

    // 关键：将 prompt 和 uc 也放入 parameters 中
    // 这样服务端会把它们写入 PNG 元数据
    parameters.prompt = finalPrompt;
    parameters.uc = config.negativePrompt || '';

    // 添加官网元数据中存在的其他字段
    parameters.version = 1;
    parameters.request_type = 'PromptGenerateRequest';

    // 添加 director 相关字段（设为 null 匹配官网）
    parameters.director_references = [];
    parameters.director_reference_strengths = null;
    parameters.director_reference_images = null;
    parameters.director_reference_descriptions = null;
    parameters.director_reference_information_extracted = null;
    parameters.director_reference_secondary_strengths = null;

    // 根据是否有角色信息决定 use_coords
    const hasCharacters = characterCaptions && characterCaptions.length > 0;

    parameters.v4_prompt = {
      caption: {
        base_caption: finalPrompt,
        char_captions: characterCaptions || [],
      },
      use_coords: hasCharacters, // 有角色时启用坐标
      use_order: true,
      legacy_uc: false,
    };

    // 为每个角色生成对应的负面提示词（空白，让 base_caption 生效）
    const charNegativeCaptions =
      characterCaptions?.map(char => ({
        char_caption: '',
        centers: char.centers,
      })) || [];

    parameters.v4_negative_prompt = {
      caption: {
        base_caption: config.negativePrompt || '',
        char_captions: charNegativeCaptions,
      },
      use_coords: false,
      use_order: false,
      legacy_uc: false,
    };
  } else {
    // V3 模型使用 negative_prompt 字段
    parameters.negative_prompt = config.negativePrompt || '';
  }

  // V4 模型不需要 input 字段，prompt 已经在 v4_prompt.caption.base_caption 中
  const requestBody: Record<string, any> = {
    model: modelName,
    action: 'generate',
    parameters,
  };

  if (!isV4Model) {
    // V3 模型需要 input 字段
    requestBody.input = finalPrompt;
  }
  // V4 模型：prompt/uc 已经在 parameters 中，不需要顶层字段

  // NovelAI 始终使用 JSON 编码请求体
  // stream='msgpack' 参数只是标记，会被写入图片元数据，不影响请求编码

  // 429 错误重试逻辑：有限次数重试
  let response: Response;
  let retryCount = 0;
  const RETRY_DELAY = 1000; // 减少重试延迟到 1 秒（原来是 3 秒）
  const MAX_RETRY_COUNT = 10; // 最大重试 10 次

  while (true) {
    // 检查取消信号
    if (signal?.aborted) {
      throw new Error('请求已取消');
    }

    try {
      response = await fetch(NOVELAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
          Accept: 'application/zip',
        },
        body: JSON.stringify(requestBody),
        signal,
      });

      if (response.ok) {
        // 请求成功，跳出循环
        break;
      }

      const errorText = await response.text().catch(() => '');

      // 对于 429 错误，限制重试次数
      if (response.status === 429) {
        retryCount++;

        // 检查是否超过最大重试次数
        if (retryCount >= MAX_RETRY_COUNT) {
          throw new Error(`NovelAI 速率限制，已重试 ${retryCount} 次，请稍后再试`);
        }

        // 使用 toastr 提示用户（每 5 次重试提示一次，避免过多提示）
        if (typeof toastr !== 'undefined' && retryCount % 5 === 1) {
          toastr.warning(
            `NovelAI 速率限制，正在自动重试... (${retryCount}/${MAX_RETRY_COUNT})`,
            '',
            { timeOut: 4000, progressBar: true }
          );
        }

        console.log(`[novelAI] 429 速率限制，重试 ${retryCount}/${MAX_RETRY_COUNT}`);
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        continue;
      }

      // 对于其他错误，直接抛出
      if (response.status === 401) {
        throw new Error('NovelAI API Key 无效或已过期');
      }
      if (response.status === 402) {
        throw new Error('NovelAI 账户余额不足 (Anlas)');
      }
      throw new Error(`NovelAI 请求失败 (${response.status}): ${errorText}`);
    } catch (error) {
      // 如果是网络错误或请求被中止，也应该抛出
      if (error instanceof Error && (error.name === 'AbortError' || signal?.aborted)) {
        throw new Error('请求已取消');
      }
      // 如果是 TypeError 且包含 fetch 相关错误，说明是网络问题
      if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) {
        throw new Error(`网络连接失败: ${error.message}。请检查网络连接或 NovelAI API 地址`);
      }
      // 其他网络错误也抛出
      throw error;
    }
  }

  const zipData = await response.arrayBuffer();
  const base64 = await extractImageFromZip(zipData);

  // 从 base64 中提取 PNG 数据
  const base64Data = base64.split(',')[1]; // 移除 data:image/png;base64, 前缀
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // 添加 prompt 和 uc 到元数据
  let updatedPngBuffer: ArrayBuffer;
  try {
    updatedPngBuffer = addPromptToMetadata(bytes.buffer, finalPrompt, config.negativePrompt || '');
  } catch (error) {
    console.warn('[novelAI] PNG 元数据更新失败，使用原始数据:', error);
    updatedPngBuffer = bytes.buffer;
  }

  // 转换回 base64
  const updatedBytes = new Uint8Array(updatedPngBuffer);
  let updatedBinaryString = '';
  for (let i = 0; i < updatedBytes.length; i++) {
    updatedBinaryString += String.fromCharCode(updatedBytes[i]);
  }
  const updatedBase64 = `data:image/png;base64,${btoa(updatedBinaryString)}`;

  return {
    base64: updatedBase64,
    seed: usedSeed,
  };
}
