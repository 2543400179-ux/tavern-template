/**
 * Emotion Tag Cache DB - IndexedDB 情绪标签缓存持久化层
 * 使用 IndexedDB 存储 LLM 生成的情绪标签结果，避免重复请求
 */

import type { EmotionTagResult } from './emotionTagLLM';

const DB_NAME = 'quiet_editor_emotion_tag_cache';
const DB_VERSION = 1;
const STORE_NAME = 'emotion_tags';

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
 * 生成缓存键
 * @param messageId 楼层消息 ID
 * @param voiceConfigHash 音色配置的 hash（包含角色列表和 characterInfo）
 */
export function makeEmotionTagCacheKey(messageId: number, voiceConfigHash: string): string {
  return `${messageId}:${voiceConfigHash}`;
}

/**
 * 简单 hash 函数（用于音色配置）
 */
export function hashVoiceConfig(characterVoices: Record<string, any>): string {
  const keys = Object.keys(characterVoices).sort();
  const data = keys.map(k => {
    const v = characterVoices[k];
    return `${k}:${v.voice}:${v.characterInfo || ''}`;
  }).join('|');
  
  // 简单的字符串 hash
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * 存入情绪标签结果
 * @param key 缓存键
 * @param result 情绪标签结果
 */
export async function putEmotionTags(key: string, result: EmotionTagResult): Promise<void> {
  try {
    const db = await openDB();
    const jsonStr = JSON.stringify(result);
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(jsonStr, key);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  } catch (error) {
    console.error('[emotionTagCacheDB] 写入缓存失败:', error);
    throw error;
  }
}

/**
 * 读取情绪标签结果，不存在则返回 null
 * @param key 缓存键
 */
export async function getEmotionTags(key: string): Promise<EmotionTagResult | null> {
  try {
    const db = await openDB();
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      
      request.onsuccess = () => {
        const jsonStr = request.result;
        if (jsonStr) {
          try {
            resolve(JSON.parse(jsonStr));
          } catch (e) {
            console.error('[emotionTagCacheDB] JSON 解析失败:', e);
            resolve(null);
          }
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  } catch (error) {
    console.error('[emotionTagCacheDB] 读取缓存失败:', error);
    return null;
  }
}

/**
 * 删除指定 key 的情绪标签
 */
export async function deleteEmotionTags(key: string): Promise<void> {
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

/**
 * 清空所有情绪标签缓存
 */
export async function clearAllEmotionTagCache(): Promise<void> {
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
    console.error('[emotionTagCacheDB] 清空缓存失败:', error);
    throw error;
  }
}

/**
 * 获取缓存统计信息
 */
export async function getEmotionTagCacheStats(): Promise<{
  count: number;
  totalSizeKB: number;
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
            totalSize += cursor.value.length * 2; // UTF-16
          }
          cursor.continue();
        } else {
          db.close();
          resolve({
            count,
            totalSizeKB: totalSize / 1024,
          });
        }
      };
      
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('[emotionTagCacheDB] 获取缓存统计失败:', error);
    return { count: 0, totalSizeKB: 0 };
  }
}
