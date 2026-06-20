/**
 * PNG 元数据处理工具
 * 用于在 PNG 图片中添加/更新 NovelAI 元数据
 */

/**
 * 在 PNG 图片的元数据中添加顶层 prompt 和 uc 字段
 * @param pngArrayBuffer 原始 PNG 数据
 * @param prompt 正向提示词
 * @param uc 负向提示词
 * @returns 包含更新元数据的新 PNG ArrayBuffer
 */
export function addPromptToMetadata(
  pngArrayBuffer: ArrayBuffer,
  prompt: string,
  uc: string,
): ArrayBuffer {
  const view = new DataView(pngArrayBuffer);
  
  // 检查 PNG 签名
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (view.getUint8(i) !== signature[i]) {
      console.error('[pngMetadata] 无效的 PNG 文件');
      return pngArrayBuffer; // 返回原始数据
    }
  }

  // 查找 NovelAI 元数据 chunk 和 Description chunk
  let offset = 8;
  let commentChunkOffset = -1;
  let commentChunkLength = 0;
  let descriptionChunkOffset = -1;
  let descriptionChunkLength = 0;
  let existingMetadata: any = null;

  while (offset < pngArrayBuffer.byteLength - 12) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7)
    );

    if (type === 'tEXt' || type === 'iTXt') {
      const dataStart = offset + 8;
      const dataBytes = new Uint8Array(pngArrayBuffer, dataStart, length);
      
      // 查找 key (null-terminated)
      let keyEnd = 0;
      while (keyEnd < dataBytes.length && dataBytes[keyEnd] !== 0) keyEnd++;
      
      const key = new TextDecoder().decode(dataBytes.slice(0, keyEnd));
      
      // 记录 Description chunk
      if (key === 'Description') {
        descriptionChunkOffset = offset;
        descriptionChunkLength = 12 + length;
      }
      
      // 检查是否是 NovelAI 元数据 (Comment)
      if (key === 'Comment') {
        try {
          let value = '';
          if (type === 'tEXt') {
            value = new TextDecoder().decode(dataBytes.slice(keyEnd + 1));
          } else if (type === 'iTXt') {
            // iTXt: skip compressed flag, compression method, language tag, translated keyword
            let textStart = keyEnd + 1;
            textStart++; // compressed flag
            textStart++; // compression method
            while (textStart < dataBytes.length && dataBytes[textStart] !== 0) textStart++; // language
            textStart++;
            while (textStart < dataBytes.length && dataBytes[textStart] !== 0) textStart++; // translated keyword
            textStart++;
            value = new TextDecoder().decode(dataBytes.slice(textStart));
          }
          
          // 尝试解析 JSON
          const json = JSON.parse(value);
          if (json.v4_prompt || json.parameters) {
            // 找到了 NovelAI 元数据
            commentChunkOffset = offset;
            commentChunkLength = 12 + length;
            existingMetadata = json;
          }
        } catch (e) {
          // 不是 JSON，继续查找
        }
      }
    }

    offset += 12 + length; // length(4) + type(4) + data + crc(4)
  }

  if (!existingMetadata) {
    console.warn('[pngMetadata] 未找到 NovelAI Comment 元数据，无法添加 prompt/uc');
    return pngArrayBuffer;
  }

  // 更新 Comment 元数据，添加顶层 prompt 和 uc
  existingMetadata.prompt = prompt;
  existingMetadata.uc = uc;

  const updatedMetadataJson = JSON.stringify(existingMetadata);
  
  // 创建新的 Comment chunk
  const newCommentChunk = createTextChunk('Comment', updatedMetadataJson);
  
  // 创建新的 Description chunk（只包含 prompt 文本）
  const newDescriptionChunk = createTextChunk('Description', prompt);

  // 构建新的 PNG
  let result = pngArrayBuffer;
  
  // 1. 替换 Comment chunk
  result = replaceChunk(result, commentChunkOffset, commentChunkLength, newCommentChunk);
  
  // 2. 替换或添加 Description chunk
  // 注意：替换 Comment 后，Description 的偏移量可能改变
  const offsetDiff = newCommentChunk.byteLength - commentChunkLength;
  if (descriptionChunkOffset > commentChunkOffset) {
    descriptionChunkOffset += offsetDiff;
  }
  
  if (descriptionChunkOffset >= 0) {
    // 替换现有的 Description
    result = replaceChunk(result, descriptionChunkOffset, descriptionChunkLength, newDescriptionChunk);
  } else {
    // 在 Comment 后添加 Description
    const insertOffset = commentChunkOffset + newCommentChunk.byteLength;
    result = insertChunk(result, insertOffset, newDescriptionChunk);
  }

  return result;
}

/**
 * 创建 tEXt chunk
 */
function createTextChunk(key: string, value: string): ArrayBuffer {
  const keyBytes = new TextEncoder().encode(key);
  const valueBytes = new TextEncoder().encode(value);
  const chunkData = new Uint8Array(keyBytes.length + 1 + valueBytes.length);
  
  chunkData.set(keyBytes, 0);
  chunkData[keyBytes.length] = 0; // null terminator
  chunkData.set(valueBytes, keyBytes.length + 1);

  const chunkLength = chunkData.length;
  const chunk = new Uint8Array(12 + chunkLength);
  const chunkView = new DataView(chunk.buffer);
  
  // Length
  chunkView.setUint32(0, chunkLength);
  
  // Type "tEXt"
  chunk[4] = 0x74; // 't'
  chunk[5] = 0x45; // 'E'
  chunk[6] = 0x58; // 'X'
  chunk[7] = 0x74; // 't'
  
  // Data
  chunk.set(chunkData, 8);
  
  // CRC
  const crc = calculateCRC(chunk.slice(4, 8 + chunkLength)); // type + data
  chunkView.setUint32(8 + chunkLength, crc);
  
  return chunk.buffer;
}

/**
 * 替换 PNG 中的一个 chunk
 */
function replaceChunk(
  pngBuffer: ArrayBuffer,
  oldOffset: number,
  oldLength: number,
  newChunk: ArrayBuffer,
): ArrayBuffer {
  const before = new Uint8Array(pngBuffer, 0, oldOffset);
  const after = new Uint8Array(pngBuffer, oldOffset + oldLength);
  
  const result = new Uint8Array(before.length + newChunk.byteLength + after.length);
  result.set(before, 0);
  result.set(new Uint8Array(newChunk), before.length);
  result.set(after, before.length + newChunk.byteLength);
  
  return result.buffer;
}

/**
 * 在指定位置插入一个 chunk
 */
function insertChunk(
  pngBuffer: ArrayBuffer,
  offset: number,
  newChunk: ArrayBuffer,
): ArrayBuffer {
  const before = new Uint8Array(pngBuffer, 0, offset);
  const after = new Uint8Array(pngBuffer, offset);
  
  const result = new Uint8Array(before.length + newChunk.byteLength + after.length);
  result.set(before, 0);
  result.set(new Uint8Array(newChunk), before.length);
  result.set(after, before.length + newChunk.byteLength);
  
  return result.buffer;
}

/**
 * 计算 PNG chunk 的 CRC-32
 */
function calculateCRC(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crc ^ data[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xedb88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
