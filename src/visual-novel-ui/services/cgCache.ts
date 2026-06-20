/**
 * CG 图片缓存服务 (基于 IndexedDB)
 * 负责生成图片的本地缓存存取、Vibe 图片存储和清理
 */

const DB_NAME = 'quiet_editor_cg_cache';
const DB_VERSION = 2;
const STORE_NAME = 'cg_images';
const VIBE_STORE_NAME = 'vibe_images';

/** 获取 IndexedDB 实例 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(VIBE_STORE_NAME)) {
        db.createObjectStore(VIBE_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 生成缓存 key: cg_{messageId}_{paragraphIndex} */
export function makeCacheKey(messageId: number, paragraphIndex: number): string {
  return `cg_${messageId}_${paragraphIndex}`;
}

/** 生成范围缓存 key: cg_{messageId}_range_{startIndex}_{endIndex} */
export function makeRangeCacheKey(messageId: number, startIndex: number, endIndex: number): string {
  return `cg_${messageId}_range_${startIndex}_${endIndex}`;
}

// ====== CG 图片存取 ======

/** 存入 CG 图片 base64 */
export async function putCGImage(key: string, base64: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(base64, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/** 读取 CG 图片 base64，不存在则返回 null */
export async function getCGImage(key: string): Promise<string | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/** 删除指定 key 的 CG 图片 */
export async function deleteCGImage(key: string): Promise<void> {
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

// ====== Vibe 图片存取 ======

/** 存入 Vibe 图片 base64 */
export async function putVibeImage(key: string, base64: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VIBE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(VIBE_STORE_NAME);
    const request = store.put(base64, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/** 读取 Vibe 图片 base64，不存在则返回 null */
export async function getVibeImage(key: string): Promise<string | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VIBE_STORE_NAME, 'readonly');
    const store = tx.objectStore(VIBE_STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/** 删除指定 key 的 Vibe 图片 */
export async function deleteVibeImage(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VIBE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(VIBE_STORE_NAME);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

// ====== 清理操作 ======

/** 清理指定楼层的所有 CG 缓存 */
export async function clearFloorCGCache(messageId: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const prefix = `cg_${messageId}_`;

    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
          cursor.delete();
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/** 清理所有 CG 缓存 */
export async function clearAllCGCache(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

// ====== 缓存估算与自动清理 ======

/** 估算当前 IndexedDB 缓存大小（字节） */
export async function estimateCacheSize(): Promise<number> {
  try {
    const db = await openDB();
    return new Promise(resolve => {
      let totalSize = 0;
      const stores = [STORE_NAME, VIBE_STORE_NAME];

      let completed = 0;
      for (const storeName of stores) {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            if (typeof cursor.value === 'string') {
              totalSize += cursor.value.length * 2; // UTF-16 ~ 2 bytes per char
            }
            cursor.continue();
          } else {
            completed++;
            if (completed === stores.length) {
              db.close();
              resolve(totalSize);
            }
          }
        };
        request.onerror = () => {
          completed++;
          if (completed === stores.length) {
            db.close();
            resolve(totalSize);
          }
        };
      }
    });
  } catch {
    return 0;
  }
}

/** 自动清理：保留最近 N 楼的 CG 缓存，清理更旧的 */
export async function autoCleanCache(keepRecentFloors: number = 50): Promise<number> {
  try {
    const db = await openDB();
    const cgKeys: { key: string; messageId: number }[] = [];

    // 收集所有 CG key 及对应的 messageId
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const key = cursor.key as string;
          const match = key.match(/^cg_(\d+)_/);
          if (match) {
            cgKeys.push({ key, messageId: parseInt(match[1]) });
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });

    // 按 messageId 降序排序
    cgKeys.sort((a, b) => b.messageId - a.messageId);

    // 保留最近 N 楼（去重 messageId）
    const keptMessageIds = new Set<number>();
    const toDelete: string[] = [];
    for (const item of cgKeys) {
      if (keptMessageIds.size < keepRecentFloors) {
        keptMessageIds.add(item.messageId);
      } else if (!keptMessageIds.has(item.messageId)) {
        toDelete.push(item.key);
      }
    }

    // 删除旧缓存
    if (toDelete.length > 0) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (const key of toDelete) {
          store.delete(key);
        }
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      });
      console.info(`[cgCache] 自动清理了 ${toDelete.length} 条旧 CG 缓存，保留了 ${keptMessageIds.size} 个楼层`);
    } else {
      db.close();
    }

    return toDelete.length;
  } catch (e) {
    console.warn('[cgCache] 自动清理失败:', e);
    return 0;
  }
}
