/**
 * Vibe Transfer 方案管理服务
 * 负责 vibe 方案的增删改查，存取全局变量，图片存 IndexedDB
 */

import { VIBE_STORAGE_KEY } from '../constants';
import type { VibeEntry, VibeScheme, VibeStorage } from '../types';
import { deleteVibeImage, getVibeImage, putVibeImage } from './cgCache';

/** 默认空存储 */
const DEFAULT_VIBE_STORAGE: VibeStorage = {
  schemes: [],
  activeSchemeId: null,
};

/** 生成唯一 ID */
function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ====== 存取 ======

/** 从酒馆全局变量加载 Vibe 存储 */
export function loadVibeStorage(): VibeStorage {
  try {
    const saved = getVariables({ type: 'global' }) as Record<string, any>;
    const storage = saved?.[VIBE_STORAGE_KEY];
    if (storage && typeof storage === 'object' && Array.isArray(storage.schemes)) {
      return storage as VibeStorage;
    }
  } catch (e) {
    console.warn('[vibeManager] 加载 Vibe 存储失败:', e);
  }
  return { ...DEFAULT_VIBE_STORAGE };
}

/** 保存 Vibe 存储到酒馆全局变量（不含 imageBase64，图片存 IndexedDB，但保留 encoding） */
export function saveVibeStorage(storage: VibeStorage): void {
  try {
    // 保存前移除 imageBase64 字段（图片已存 IndexedDB），但保留 encoding 字段
    const cleanStorage: VibeStorage = {
      schemes: storage.schemes.map(s => ({
        ...s,
        vibes: s.vibes.map(v => {
          const { imageBase64, ...rest } = v;
          // 明确保留 encoding 字段（如果存在）
          return {
            ...rest,
            ...(v.encoding ? { encoding: v.encoding } : {}),
          } as VibeEntry;
        }),
      })),
      activeSchemeId: storage.activeSchemeId,
    };
    const current = (getVariables({ type: 'global' }) as Record<string, any>) || {};
    current[VIBE_STORAGE_KEY] = cleanStorage;
    replaceVariables(current, { type: 'global' });
  } catch (e) {
    console.error('[vibeManager] 保存 Vibe 存储失败:', e);
  }
}

// ====== .naidata 和 .naiv4vibebundle 解析 ======

/**
 * 解析 .naidata 文件内容，提取图片 base64
 * .naidata 是 NovelAI 导出的 JSON 格式，包含 image 字段
 */
export function parseNaidataFile(fileContent: string): string {
  try {
    const data = JSON.parse(fileContent);
    if (data.image && typeof data.image === 'string') {
      return data.image;
    }
    if (data.data && typeof data.data === 'string') {
      return data.data;
    }
    throw new Error('未找到有效的图片数据');
  } catch (e: any) {
    if (e.message === '未找到有效的图片数据') throw e;
    throw new Error(`解析 .naidata 文件失败: ${e.message}`);
  }
}

/**
 * 解析 .naiv4vibebundle 文件内容，提取 vibe 条目
 * .naiv4vibebundle 是 NovelAI V4 的 Vibe Bundle 格式，包含多个 vibe 的编码数据
 * 注意：此格式不包含图片 base64，而是直接存储模型特征向量
 * @returns 包含 vibe 条目的数组，每个条目包含 id、name、encoding、infoExtracted、strength
 */
export function parseVibeBundle(fileContent: string): Array<{
  id: string;
  name: string;
  encoding: string;
  infoExtracted: number;
  strength: number;
}> {
  try {
    const data = JSON.parse(fileContent);
    if (data.identifier !== 'novelai-vibe-transfer-bundle') {
      throw new Error('不是有效的 NovelAI Vibe Bundle 文件');
    }
    if (!Array.isArray(data.vibes)) {
      throw new Error('Vibe Bundle 格式错误：缺少 vibes 数组');
    }

    return data.vibes.map((vibe: any) => {
      // 提取 v4-5full 模型的编码数据
      const encoding = vibe.encodings?.['v4-5full']?.unknown?.encoding;
      if (!encoding) {
        throw new Error(`Vibe ${vibe.id} 缺少编码数据`);
      }

      return {
        id: vibe.id,
        name: vibe.name || vibe.id.substring(0, 13),
        encoding,
        infoExtracted: vibe.importInfo?.information_extracted ?? 1.0,
        strength: vibe.importInfo?.strength ?? 0.6,
      };
    });
  } catch (e: any) {
    throw new Error(`解析 .naiv4vibebundle 文件失败: ${e.message}`);
  }
}

// ====== 方案管理 ======

/** 创建新方案 */
export function createScheme(name: string): VibeStorage {
  const storage = loadVibeStorage();
  const newScheme: VibeScheme = {
    id: generateId(),
    name,
    vibes: [],
  };
  storage.schemes.push(newScheme);
  if (storage.schemes.length === 1) {
    storage.activeSchemeId = newScheme.id;
  }
  saveVibeStorage(storage);
  return storage;
}

/** 删除方案（同时清理 IndexedDB 中的图片） */
export function deleteScheme(schemeId: string): VibeStorage {
  const storage = loadVibeStorage();
  const scheme = storage.schemes.find(s => s.id === schemeId);
  if (scheme) {
    // 异步清理 IndexedDB 中的图片
    scheme.vibes.forEach(v => {
      deleteVibeImage(v.id).catch(e => console.warn('[vibeManager] 清理 vibe 图片失败:', e));
    });
  }
  storage.schemes = storage.schemes.filter(s => s.id !== schemeId);
  if (storage.activeSchemeId === schemeId) {
    storage.activeSchemeId = storage.schemes.length > 0 ? storage.schemes[0].id : null;
  }
  saveVibeStorage(storage);
  return storage;
}

/** 重命名方案 */
export function renameScheme(schemeId: string, newName: string): VibeStorage {
  const storage = loadVibeStorage();
  const scheme = storage.schemes.find(s => s.id === schemeId);
  if (scheme) {
    scheme.name = newName;
    saveVibeStorage(storage);
  }
  return storage;
}

/** 设置激活方案 */
export function setActiveScheme(schemeId: string | null): VibeStorage {
  const storage = loadVibeStorage();
  storage.activeSchemeId = schemeId;
  saveVibeStorage(storage);
  return storage;
}

/** 向方案添加 vibe（图片存 IndexedDB，元数据存全局变量） */
export function addVibeToScheme(
  schemeId: string,
  fileName: string,
  imageBase64?: string,
  encoding?: string,
): VibeStorage {
  const storage = loadVibeStorage();
  const scheme = storage.schemes.find(s => s.id === schemeId);
  if (!scheme) {
    console.warn('[vibeManager] 方案不存在:', schemeId);
    return storage;
  }
  const entry: VibeEntry = {
    id: generateId(),
    fileName,
    imageBase64,
    encoding,
    infoExtracted: 1.0,
    strength: 0.6,
  };
  // 如果有图片，异步存到 IndexedDB
  if (imageBase64) {
    putVibeImage(entry.id, imageBase64).catch(e => console.warn('[vibeManager] 保存 vibe 图片失败:', e));
  }
  scheme.vibes.push(entry);
  saveVibeStorage(storage);
  return storage;
}

/** 从方案删除 vibe */
export function removeVibeFromScheme(schemeId: string, vibeId: string): VibeStorage {
  const storage = loadVibeStorage();
  const scheme = storage.schemes.find(s => s.id === schemeId);
  if (scheme) {
    scheme.vibes = scheme.vibes.filter(v => v.id !== vibeId);
    saveVibeStorage(storage);
    // 异步清理 IndexedDB 中的图片
    deleteVibeImage(vibeId).catch(e => console.warn('[vibeManager] 清理 vibe 图片失败:', e));
  }
  return storage;
}

/** 更新 vibe 参数 */
export function updateVibeParams(
  schemeId: string,
  vibeId: string,
  params: { infoExtracted?: number; strength?: number },
): VibeStorage {
  const storage = loadVibeStorage();
  const scheme = storage.schemes.find(s => s.id === schemeId);
  if (scheme) {
    const vibe = scheme.vibes.find(v => v.id === vibeId);
    if (vibe) {
      if (params.infoExtracted !== undefined) vibe.infoExtracted = params.infoExtracted;
      if (params.strength !== undefined) vibe.strength = params.strength;
      saveVibeStorage(storage);
    }
  }
  return storage;
}

// ====== 获取激活方案的 vibes（从 IndexedDB 异步加载图片）======

/** 获取当前激活方案的所有 vibe 条目（用于传入 generateImage） */
export function getActiveVibes(): VibeEntry[] {
  const storage = loadVibeStorage();
  if (!storage.activeSchemeId) return [];
  const scheme = storage.schemes.find(s => s.id === storage.activeSchemeId);
  return scheme?.vibes ?? [];
}

/** 从 IndexedDB 异步加载单个 vibe 的图片 base64 */
export async function getVibeImageAsync(vibeId: string): Promise<string | null> {
  return getVibeImage(vibeId);
}

/** 获取当前激活方案的所有 vibe 条目（含图片），异步加载图片 */
export async function getActiveVibesWithImages(): Promise<VibeEntry[]> {
  const vibes = getActiveVibes();
  if (vibes.length === 0) return [];
  // 并行从 IndexedDB 加载所有图片
  const results = await Promise.all(
    vibes.map(async v => {
      const imageBase64 = await getVibeImage(v.id);
      return { ...v, imageBase64: imageBase64 ?? v.imageBase64 ?? '' };
    }),
  );
  return results;
}
