/**
 * 角色外貌库服务
 * 负责从世界书读写角色外貌描述（Danbooru 风格 tags）
 * 数据存储在世界书条目 [res]角色外貌库 中，格式为 YAML
 */

import YAML from 'yaml';

/** 世界书中角色外貌库条目的约定名称 */
const CHAR_APPEARANCES_ENTRY_NAME = '[res]角色外貌库';

/**
 * 获取当前角色卡绑定的世界书名称
 * 优先使用角色卡主世界书，其次使用附加世界书中的第一个
 */
async function getTargetWorldbookName(): Promise<string | null> {
  try {
    const charWbs = getCharWorldbookNames('current');
    if (charWbs.primary) return charWbs.primary;
    if (charWbs.additional.length > 0) return charWbs.additional[0];
    // 尝试全局世界书
    const globalWbs = getGlobalWorldbookNames();
    if (globalWbs.length > 0) return globalWbs[0];
  } catch (e) {
    console.warn('[characterAppearances] 获取世界书名称失败:', e);
  }
  return null;
}

/**
 * 从世界书加载角色外貌库
 * @returns Record<角色名, Danbooru tags>
 */
export async function loadCharacterAppearances(): Promise<Record<string, string>> {
  try {
    const wbName = await getTargetWorldbookName();
    if (!wbName) {
      console.warn('[characterAppearances] 未找到可用的世界书');
      return {};
    }

    const entries = await getWorldbook(wbName);
    if (!entries || entries.length === 0) {
      console.warn('[characterAppearances] 世界书为空或无效');
      return {};
    }

    // 查找名称或主要关键字包含 [res]角色外貌库 的条目
    const entry = entries.find((e: any) => 
      e.name?.includes(CHAR_APPEARANCES_ENTRY_NAME) || 
      e.strategy?.keys?.some((k: string) => k.includes(CHAR_APPEARANCES_ENTRY_NAME))
    );
    if (!entry || !entry.content) {
      console.warn('[characterAppearances] 未找到角色外貌库条目');
      return {};
    }

    const parsed = YAML.parse(entry.content);
    return parsed || {};
  } catch (e) {
    console.error('[characterAppearances] 加载角色外貌库失败:', e);
    return ;
  }
}

/**
 * 保存角色外貌库到世界书
 * @param appearances Record<角色名, Danbooru tags>
 */
export async function saveCharacterAppearances(appearances: Record<string, string>): Promise<void> {
  try {
    const wbName = await getTargetWorldbookName();
    if (!wbName) {
      throw new Error('未找到可用的世界书');
    }

    const entries = await getWorldbook(wbName);
    if (!entries) {
      throw new Error('世界书为空或无效');
    }

    // 查找名称或主要关键字包含 [res]角色外貌库 的条目
    const entryIndex = entries.findIndex((e: any) => 
      e.name?.includes(CHAR_APPEARANCES_ENTRY_NAME) || 
      e.strategy?.keys?.some((k: string) => k.includes(CHAR_APPEARANCES_ENTRY_NAME))
    );

    const yamlContent = YAML.stringify(appearances);

    if (entryIndex >= 0) {
      // 更新现有条目
      entries[entryIndex].content = yamlContent;
    } else {
      // 创建新条目
      const newEntry: any = {
        name: CHAR_APPEARANCES_ENTRY_NAME,
        enabled: true,
        strategy: {
          type: 'constant' as const,
          keys: [CHAR_APPEARANCES_ENTRY_NAME],
          keys_secondary: { logic: 'and_any' as const, keys: [] },
          scan_depth: 'same_as_global' as const,
        },
        position: {
          type: 'after_character_definition' as const,
          role: 'system' as const,
          depth: 0,
          order: 0,
        },
        content: yamlContent,
        probability: 100,
        recursion: {
          prevent_incoming: false,
          prevent_outgoing: false,
          delay_until: null,
        },
        effect: {
          sticky: null,
          cooldown: null,
          delay: null,
        },
      };
      entries.push(newEntry);
    }

    await replaceWorldbook(wbName, entries);
  } catch (e) {
    console.error('[characterAppearances] 保存角色外貌库失败:', e);
    throw e;
  }
}

/**
 * 获取指定角色的外貌描述
 * @param charName 角色名
 */
export async function getCharacterAppearance(charName: string): Promise<string> {
  const appearances = await loadCharacterAppearances();
  return appearances[charName] || '';
}

/**
 * 设置指定角色的外貌描述
 * @param charName 角色名
 * @param appearance Danbooru tags
 */
export async function setCharacterAppearance(charName: string, appearance: string): Promise<void> {
  const appearances = await loadCharacterAppearances();
  appearances[charName] = appearance;
  await saveCharacterAppearances(appearances);
}

/**
 * 删除指定角色的外貌描述
 * @param charName 角色名
 */
/**
 * 新增或更新指定角色的外貌描述（upsert = update or insert）
 * @param charName 角色名
 * @param appearance Danbooru tags
 */
export async function upsertCharacterAppearance(charName: string, appearance: string): Promise<void> {
  await setCharacterAppearance(charName, appearance);
}

export async function deleteCharacterAppearance(charName: string): Promise<void> {
  const appearances = await loadCharacterAppearances();
  delete appearances[charName];
  await saveCharacterAppearances(appearances);
}
