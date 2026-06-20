import YAML from 'yaml';
import { DialogueSegment, ResourceConfig } from './types';

/**
 * 涓栫晫涔﹁祫婧愭潯鐩殑绾﹀畾鍚嶇О
 * World book resource entry name convention
 * Users create an entry with this name in the world book, and fill in YAML format resource mappings */
const RESOURCE_ENTRY_NAME = '[res]资源库';
// ============ 鍥剧墖棰勫姞杞界郴缁?============

/**
 * 棰勫姞杞藉崟寮犲浘鐗囷紝杩斿洖 Promise
 * 宸茬紦瀛樼殑鍥剧墖浼氱珛鍗宠繑鍥烇紝姝ｅ湪鍔犺浇涓殑浼氬鐢ㄥ悓涓€ Promise
 */
export function preloadImage(url: string): Promise<HTMLImageElement> {
  // 使用函数内部的静态变量来避免 webpack 作用域提升问题
  if (!preloadImage.cache) {
    preloadImage.cache = new Map<string, HTMLImageElement>();
  }
  if (!preloadImage.loading) {
    preloadImage.loading = new Map<string, Promise<HTMLImageElement>>();
  }
  
  const preloadedImages = preloadImage.cache;
  const loadingPromises = preloadImage.loading;
  
  if (!url) return Promise.resolve(new Image());

  // Already cached
  if (preloadedImages.has(url)) {
    return Promise.resolve(preloadedImages.get(url)!);
  }

  // 姝ｅ湪鍔犺浇涓紝澶嶇敤 Promise
  if (loadingPromises.has(url)) {
    return loadingPromises.get(url)!;
  }

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      preloadedImages.set(url, img);
      loadingPromises.delete(url);
      resolve(img);
    };
    img.onerror = () => {
      loadingPromises.delete(url);
      reject(new Error(`Failed to preload: ${url}`));
    };
    img.src = url;
  });

  loadingPromises.set(url, promise);
  return promise;
}

// 添加静态属性声明
declare module './resourceLoader' {
  export interface preloadImage {
    cache?: Map<string, HTMLImageElement>;
    loading?: Map<string, Promise<HTMLImageElement>>;
  }
}

/**
 * 妫€鏌ュ浘鐗囨槸鍚﹀凡棰勫姞杞藉畬锟? */
export function isImagePreloaded(url: string): boolean {
  if (!preloadImage.cache) return false;
  return preloadImage.cache.has(url);
}

/**
 * 鏍规嵁褰撳墠娈佃惤绱㈠紩锛岄鍔犺浇鍓嶅悗 N 娈电殑绔嬬粯鍜岃儗鏅浘
 * 鍐呰仈璧勬簮瑙ｆ瀽閫昏緫浠ラ伩鍏嶄笌 parser.ts 鐨勫惊鐜緷锟? */
export function preloadNearbySegments(
  segments: DialogueSegment[],
  currentIndex: number,
  config: ResourceConfig,
  range: number = 5,
): void {
  // 鍐呰仈鐨勮祫婧愯В鏋愶細角色立绘
  const resolveChar = (charName: string, face?: string): string => {
    const charImages = config.characters[charName];
    if (!charImages) return '';
    if (face && charImages[face]) return charImages[face];
    if (charImages['榛樿']) return charImages['榛樿'];
    if (charImages['default']) return charImages['default'];
    const keys = Object.keys(charImages);
    return keys.length > 0 ? charImages[keys[0]] : '';
  };

  // 内联的资源解析：背景图（优先 bgKey，其次 bgName）
  const resolveBg = (bgName: string, bgKey?: string): string => {
    if (bgKey && config.backgrounds[bgKey]) return config.backgrounds[bgKey];
    if (bgName && config.backgrounds[bgName]) return config.backgrounds[bgName];
    return '';
  };

  // 内联的资源解析：CG 图
  const resolveCg = (cgName: string): string => config.cg[cgName] || '';

  // 累积状态用于计算每个段落实际需要的资源（向前扫描）
  let charNameForward = '';
  let aboutNameForward = '';
  let faceNameForward = '';

  // 先扫描到 currentIndex 获取当前累积状态
  for (let i = 0; i <= currentIndex; i++) {
    const segment = segments[i];
    if (!segment || !segment.eff) continue;
    const eff = segment.eff;
    if (eff.char) {
      charNameForward = eff.char;
      aboutNameForward = '';
      faceNameForward = '';
    }
    if (eff.about) {
      aboutNameForward = eff.about;
      faceNameForward = '';
    }
    if (eff.face) faceNameForward = eff.face;
  }

  // ====== 预加载向前（前进）方向的资源 ======
  const endForward = Math.min(currentIndex + range, segments.length - 1);
  for (let i = currentIndex + 1; i <= endForward; i++) {
    const segment = segments[i];
    if (!segment || !segment.eff) continue;
    const eff = segment.eff;
    if (eff.char) {
      charNameForward = eff.char;
      aboutNameForward = '';
      faceNameForward = '';
    }
    if (eff.about) {
      aboutNameForward = eff.about;
      faceNameForward = '';
    }
    if (eff.face) faceNameForward = eff.face;

    const spriteChar = aboutNameForward || charNameForward;
    if (spriteChar) {
      const url = resolveChar(spriteChar, faceNameForward);
      if (url) preloadImage(url);
    }

    if (eff.bg) {
      const url = resolveBg(eff.bg, eff.bgKey);
      if (url) preloadImage(url);
    }

    if (eff.cg) {
      const url = resolveCg(eff.cg);
      if (url) preloadImage(url);
    }
  }

  // ====== 预加载向后（后退）方向的资源 ======
  // 反向扫描：从 currentIndex-1 往前推 range 段
  const startBackward = Math.max(currentIndex - range, 0);
  
  // 为了正确计算累积状态，需要从 0 开始扫描到目标段落
  for (let targetIdx = currentIndex - 1; targetIdx >= startBackward; targetIdx--) {
    let charNameBackward = '';
    let aboutNameBackward = '';
    let faceNameBackward = '';
    
    // 扫描到 targetIdx 获取该段落的累积状态
    for (let i = 0; i <= targetIdx; i++) {
      const segment = segments[i];
      if (!segment || !segment.eff) continue;
      const eff = segment.eff;
      if (eff.char) {
        charNameBackward = eff.char;
        aboutNameBackward = '';
        faceNameBackward = '';
      }
      if (eff.about) {
        aboutNameBackward = eff.about;
        faceNameBackward = '';
      }
      if (eff.face) faceNameBackward = eff.face;
    }
    
    // 预加载该段落的资源
    const spriteChar = aboutNameBackward || charNameBackward;
    if (spriteChar) {
      const url = resolveChar(spriteChar, faceNameBackward);
      if (url) preloadImage(url);
    }
    
    const segment = segments[targetIdx];
    if (segment && segment.eff) {
      if (segment.eff.bg) {
        const url = resolveBg(segment.eff.bg, segment.eff.bgKey);
        if (url) preloadImage(url);
      }
      if (segment.eff.cg) {
        const url = resolveCg(segment.eff.cg);
        if (url) preloadImage(url);
      }
    }
  }
}

/**
 * 涓栫晫锟?YAML 璧勬簮鏍煎紡绀轰緥:
 *
 * ```yaml
 * 角色立绘:
 *   濂充富:
 *     寰瑧: https://example.com/heroine/smile.png
 *     鐤戞儜: https://example.com/heroine/confused.png
 *     榛樿: https://example.com/heroine/default.png
 *   鐢蜂富:
 *     骞虫贰: https://example.com/hero/neutral.png
 *     榛樿: https://example.com/hero/default.png
 *
 * 背景图?
 *   鏁欏: https://example.com/bg/classroom.jpg
 *   璧板粖: https://example.com/bg/hallway.jpg
 *
 * BGM:
 *   娓╂煍: https://example.com/bgm/gentle.mp3
 *   绱у紶: https://example.com/bgm/tense.mp3
 *
 * CG:
 *   閲嶏拷? https://example.com/cg/reunion.jpg
 *   鍐虫垬: https://example.com/cg/final_battle.jpg
 * ```
 */

interface RawResourceYaml {
  角色立绘?: Record<string, Record<string, string>>;
  背景图?: Record<string, string>;
  BGM?: Record<string, string>;
  CG?: Record<string, string>;
  /** 角色外貌鎻忚堪 tags锛堢敤浜庤緟锟?CG 鐢熸垚鎻愮ず璇嶏級 */
  角色外貌?: Record<string, string>;
}

/**
 * 灏嗕笘鐣屼功 YAML 鍐呭瑙ｆ瀽锟?ResourceConfig
 */
function parseResourceYaml(yamlContent: string): ResourceConfig {
  try {
    const raw = YAML.parse(yamlContent) as RawResourceYaml;

    return {
      characters: raw?.角色立绘 ?? {},
      backgrounds: raw?.背景图 ?? {},
      bgm: raw?.BGM ?? {},
      cg: raw?.CG ?? {},
      characterAppearances: raw?.角色外貌 ?? {},
    };
  } catch (e) {
    console.error('[wasteland-echoes-ui] 资源 YAML 解析失败:', e);
    return { characters: {}, backgrounds: {}, bgm: {}, cg: {}, characterAppearances: {} };
  }
}

/**
 * 从角色卡绑定的世界书中查找资源条目
 *
 * 查找顺序:
 * 1. 角色卡主世界书
 * 2. 角色卡附加世界书
 * 3. 全局世界书
 */
async function findResourceEntry(): Promise<string | null> {
  try {
    // 尝试从角色卡世界书中查找
    const charWorldbooks = getCharWorldbookNames('current');
    const worldbookNames: string[] = [];

    if (charWorldbooks.primary) {
      worldbookNames.push(charWorldbooks.primary);
    }
    worldbookNames.push(...charWorldbooks.additional);

    // 也检查全局世界书
    const globalNames = getGlobalWorldbookNames();
    worldbookNames.push(...globalNames);

    // 去重
    const uniqueNames = [...new Set(worldbookNames)];

    for (const wbName of uniqueNames) {
      try {
        const entries = await getWorldbook(wbName);
        // 资源条目可以是关闭的（enabled: false），这样不会作为提示词发给 AI 浪费 token
        // getWorldbook 能读到所有条目（无论开关），所以这里不检查 enabled
        const resourceEntry = entries.find(entry => entry.name === RESOURCE_ENTRY_NAME || entry.name.includes('[res]'));
        if (resourceEntry && resourceEntry.content) {
          console.info(
            `[wasteland-echoes-ui] 从世界书 "${wbName}" 中找到资源条目 "${resourceEntry.name}" (enabled=${resourceEntry.enabled})`,
          );
          return resourceEntry.content;
        }
      } catch (e) {
        // 跳过无法访问的世界书
        continue;
      }
    }

    console.warn('[wasteland-echoes-ui] 未在任何世界书中找到资源条目');
    return null;
  } catch (e) {
    console.error('[wasteland-echoes-ui] 查找资源条目时出错:', e);
    return null;
  }
}

/**
 * 从世界书中查找语音配置条目 [res]角色语音
 */
async function findVoiceConfigEntry(): Promise<string | null> {
  try {
    const charWorldbooks = getCharWorldbookNames('current');
    const worldbookNames: string[] = [];

    if (charWorldbooks.primary) {
      worldbookNames.push(charWorldbooks.primary);
    }
    worldbookNames.push(...charWorldbooks.additional);

    const globalNames = getGlobalWorldbookNames();
    worldbookNames.push(...globalNames);

    const uniqueNames = [...new Set(worldbookNames)];

    for (const wbName of uniqueNames) {
      try {
        const entries = await getWorldbook(wbName);
        // 查找语音配置条目（通常是关闭的，不发给 AI）
        const voiceEntry = entries.find(
          entry => entry.name === '[res]角色语音' || entry.name.includes('角色语音') || entry.name.includes('voices')
        );
        if (voiceEntry && voiceEntry.content) {
          console.info(
            `[wasteland-echoes-ui] 从世界书 "${wbName}" 中找到语音配置条目 "${voiceEntry.name}" (enabled=${voiceEntry.enabled})`,
          );
          return voiceEntry.content;
        }
      } catch (e) {
        continue;
      }
    }

    console.warn('[wasteland-echoes-ui] 未在世界书中找到语音配置条目');
    return null;
  } catch (e) {
    console.error('[wasteland-echoes-ui] 查找语音配置条目时出错:', e);
    return null;
  }
}

/**
 * 从世界书加载资源映射配置
 *
 * @returns 解析后的 ResourceConfig，如果找不到资源条目则返回空配置
 */
export async function loadResourceConfig(): Promise<ResourceConfig> {
  const yamlContent = await findResourceEntry();

  if (!yamlContent) {
    return { characters: {}, backgrounds: {}, bgm: {}, cg: {}, characterAppearances: {} };
  }

  const config = parseResourceYaml(yamlContent);

  // 从 [res]角色外貌 条目加载角色外貌（优先级高于资源库中的角色外貌字段）
  try {
    const { loadCharacterAppearances } = await import('./services/characterAppearances');
    const appearances = await loadCharacterAppearances();
    if (Object.keys(appearances).length > 0) {
      config.characterAppearances = appearances;
    }
  } catch (e) {
    console.warn('[resourceLoader] 加载角色外貌库失败:', e);
  }

  // 从世界书加载语音配置
  try {
    const voiceConfigJson = await findVoiceConfigEntry();
    if (voiceConfigJson) {
      const voiceConfig = JSON.parse(voiceConfigJson);
      config.voices = voiceConfig;
    }
  } catch (e) {
    console.warn('[resourceLoader] 加载语音配置失败:', e);
  }

  return config;
}

/**
 * 锟?ResourceConfig 涓彁鍙栨墍锟?key 鍚嶇О锛堜笉锟?URL锛夛紝鐢熸垚绱у噾鐨勮祫婧愮洰褰曟枃鏈拷? * 鐢ㄤ簬閫氳繃 injectPrompts 娉ㄥ叆锟?AI锛岃 AI 鐭ラ亾鏈夊摢浜涘彲鐢ㄨ祫锟?key锟? * 鑰屼笉蹇呮妸瀹屾暣 URL 鍙戦€佸嚭鍘绘氮锟?token锟? *
 * 杈撳嚭鏍煎紡绀轰緥:
 * ```
 * [鍙敤璧勬簮key]
 * 角色立绘: 濂充富(寰瑧,鐤戞儜,榛樿), 鐢蜂富(骞虫贰,榛樿)
 * 背景图? 鏁欏, 璧板粖, 搴熷
 * BGM: 娓╂煍, 绱у紶
 * CG: 閲嶏拷? 鍐虫垬
 * ```
 */
export function buildResourceKeysSummary(config: ResourceConfig): string {
  const lines: string[] = ['[鍙敤璧勬簮key]'];

  // 角色立绘: 瑙掕壊锟?琛ㄦ儏1,琛ㄦ儏2,...)
  const charParts = Object.entries(config.characters).map(
    ([name, faces]) => `${name}(${Object.keys(faces).join(',')})`,
  );
  if (charParts.length) lines.push(`角色立绘: ${charParts.join(', ')}`);

  // 背景图?  const bgKeys = Object.keys(config.backgrounds);
  if (bgKeys.length) lines.push(`背景图? ${bgKeys.join(', ')}`);

  // BGM
  const bgmKeys = Object.keys(config.bgm);
  if (bgmKeys.length) lines.push(`BGM: ${bgmKeys.join(', ')}`);

  // CG
  const cgKeys = Object.keys(config.cg);
  if (cgKeys.length) lines.push(`CG: ${cgKeys.join(', ')}`);

  return lines.join('\n');
}
