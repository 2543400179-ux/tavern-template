/**
 * Voice Cache DB - IndexedDB 语音缓存持久化层（参考 cgCache 实现）
 * 使用 IndexedDB 存储合成的语音 Blob（转 base64），避免重复请求 API
 */

const DB_NAME = 'quiet_editor_voice_cache';
const DB_VERSION = 1;
const STORE_NAME = 'voice_audio';

/** 获取 IndexedDB 实例 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 将 Blob 转换为 base64
 */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * 将 base64 转换为 Blob
 */
function base64ToBlob(base64: string): Blob {
  const parts = base64.split(',');
  const contentType = parts[0].match(/:(.*?);/)?.[1] || 'audio/wav';
  const binaryString = atob(parts[1]);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: contentType });
}

// ====== 语音存取 ======

/**
 * 存入语音 Blob
 * @param key 缓存键（文本+音色）
 * @param audioBlob 音频 Blob
 */
export async function putVoiceAudio(key: string, audioBlob: Blob): Promise<void> {
  try {
    const db = await openDB();
    const base64 = await blobToBase64(audioBlob);
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(base64, key);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  } catch (error) {
    console.error('[voiceCacheDB] 写入缓存失败:', error);
    throw error;
  }
}

/**
 * 读取语音 Blob，不存在则返回 null
 * @param key 缓存键
 */
export async function getVoiceAudio(key: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      
      request.onsuccess = () => {
        const base64 = request.result;
        if (base64) {
          resolve(base64ToBlob(base64));
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  } catch (error) {
    console.error('[voiceCacheDB] 读取缓存失败:', error);
    return null;
  }
}

/**
 * 删除指定 key 的语音
 */
export async function deleteVoiceAudio(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

// ====== 清理操作 ======

/**
 * 清空所有语音缓存
 */
export async function clearAllVoiceCache(): Promise<void> {
  try {
    const db = await openDB();
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  } catch (error) {
    console.error('[voiceCacheDB] 清空缓存失败:', error);
    throw error;
  }
}

// ====== 缓存估算 ======

/**
 * 估算当前语音缓存大小（字节）
 */
export async function estimateVoiceCacheSize(): Promise<number> {
  try {
    const db = await openDB();
    
    return new Promise(resolve => {
      let totalSize = 0;
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.openCursor();
      
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          if (typeof cursor.value === 'string') {
            totalSize += cursor.value.length * 2; // UTF-16 ~ 2 bytes per char
          }
          cursor.continue();
        } else {
          db.close();
          resolve(totalSize);
        }
      };
      
      request.onerror = () => {
        db.close();
        resolve(totalSize);
      };
    });
  } catch {
    return 0;
  }
}

/**
 * 获取缓存统计信息
 */
export async function getVoiceCacheStats(): Promise<{
  count: number;
  totalSizeMB: number;
}> {
  try {
    const db = await openDB();
    
    return new Promise((resolve, reject) => {
      let count = 0;
      let totalSize = 0;
      
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.openCursor();
      
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          count++;
          if (typeof cursor.value === 'string') {
            totalSize += cursor.value.length * 2;
          }
          cursor.continue();
        } else {
          db.close();
          resolve({
            count,
            totalSizeMB: totalSize / 1024 / 1024,
          });
        }
      };
      
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('[voiceCacheDB] 获取缓存统计失败:', error);
    return { count: 0, totalSizeMB: 0 };
  }
}
