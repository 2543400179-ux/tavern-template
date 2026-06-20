import waitUntil from 'async-wait-until';
import _, { result } from 'lodash';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CGConfigScreen } from './components/CGConfigScreen';
import { CollectionScreen } from './components/CollectionScreen';
import { GameInterface } from './components/GameInterface';
import { Loader2 } from './components/Icons';
import { LoadingScreen } from './components/LoadingScreen';
import { LogScreen } from './components/LogScreen';
import { NoiseOverlay } from './components/NoiseOverlay';
import { SaveLoadScreen } from './components/SaveLoadScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { VoiceConfigModal } from './components/VoiceConfigModal';
import { AUDIO_ASSETS, RESOURCE_CONFIG, SAMPLE_CHARACTER } from './constants';
import {
  BgFullState,
  extractLastBgFull,
  extractLastBgm,
  extractLastDesc,
  parseDialogueScript,
  resolveBgmUrl as parserResolveBgmUrl,
} from './parser';
import { loadResourceConfig } from './resourceLoader';
import { autoCleanCache, clearFloorCGCache } from './services/cgCache';
import { loadCGSettings, triggerCGGeneration } from './services/cgTaskManager';
import { getPreloadProgress, onPreloadProgress, startPreload } from './services/preloadService';
import {
  BgWorldState,
  CharacterProfile,
  CollectionEntry,
  GameSettings,
  ParsedScript,
  ResourceConfig,
  ScreenView,
  StatOverride,
} from './types';

// ====== MVU 数据解析辅助函数（组件外部，稳定引用）?=====

/** 安全转数字：值为 undefined 时用 fallback，值为 0 时保留?0（不被?|| 吞掉）?*/
function toNum(val: unknown, fallback: number): number {
  if (val === undefined || val === null || val === '') return fallback;
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

/** 从全局变量读取已保存的头像 URL */
function loadAvatarUrl(): string {
  try {
    const saved = getVariables({ type: 'global' }) as Record<string, any>;
    return saved?.wasteland_echoes_settings?.avatarUrl || '';
  } catch {
    return '';
  }
}

/** �?MVU stat_data 直接构建 CharacterProfile（适配动�?<user> key�?*/
function buildCharacterFromMvu(statData: Record<string, any>, prev: CharacterProfile): CharacterProfile {
  try {
    // 动态查找玩�?key：stat_data 中除了?'世界' �?$ / _ 开头的第一个?key
    const userKey = Object.keys(statData).find(k => !k.startsWith('$') && !k.startsWith('_') && k !== '世界');
    const 角色 = userKey ? _.get(statData, userKey, {}) : {};
    const 负重 = _.get(角色, '负重', {});
    const 技能Raw = _.get(角色, '技能', {});
    const 背包Raw = _.get(角色, '背包', {});

    return {
      ...prev,
      name: userKey || prev.name,
      // 保留 avatarUrl，不被?MVU 数据覆盖
      avatarUrl: prev.avatarUrl,
      vitals: {
        identity: String(_.get(角色, '身份', prev.vitals.identity)),
        load: {
          current: toNum(_.get(负重, '当前'), prev.vitals.load.current),
          max: toNum(_.get(负重, '上限'), prev.vitals.load.max),
        },
        trauma: String(_.get(角色, '创伤', prev.vitals.trauma)),
        temperature: toNum(_.get(角色, '体温'), prev.vitals.temperature),
        antibody: String(_.get(角色, '抗体', prev.vitals.antibody)),
      },
      attributes: {
        strength: toNum(_.get(角色, '力量'), prev.attributes.strength),
        agility: toNum(_.get(角色, '敏捷'), prev.attributes.agility),
        endurance: toNum(_.get(角色, '体力'), prev.attributes.endurance),
      },
      skills: typeof 技能Raw === 'object' && 技能Raw !== null ? 技能Raw : prev.skills,
      inventory: typeof 背包Raw === 'object' && 背包Raw !== null ? 背包Raw : prev.inventory,
      relationships: {
        付觉: { 信任度: toNum(_.get(角色, '付觉.信任度'), prev.relationships?.付觉?.信任度 ?? 0) },
        白河: { 归属感: toNum(_.get(角色, '白河.归属感'), prev.relationships?.白河?.归属感 ?? 0) },
        沈栖: { 安全感: toNum(_.get(角色, '沈栖.安全感'), prev.relationships?.沈栖?.安全感 ?? 0) },
      },
    };
  } catch (e) {
    console.warn('[wasteland-echoes-ui] buildCharacterFromMvu 解析异常，保留旧数据据:', e);
    return prev;
  }
}

/** bg 世界状态默认值值*/
const DEFAULT_BG_WORLD_STATE: BgWorldState = {
  场景: '未知区域',
  威胁度等级: '低',
  时间: '',
};

// ====== Error Boundary：防止止GameInterface 渲染崩溃导致整个界面板白屏 ======
class GameErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[wasteland-echoes-ui] GameInterface 渲染崩溃:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-stone-950 text-stone-400 gap-4 p-8">
          <Loader2 size={28} className="text-red-600" />
          <p className="font-mono-retro text-xs tracking-widest text-red-500">RENDER_ERROR</p>
          <p className="font-serif-sc text-sm text-stone-500 text-center max-w-md leading-relaxed">
            界面渲染出错，请尝试重新 Roll 或刷新页面板?{' '}
          </p>
          <pre className="text-[10px] text-stone-600 max-w-md overflow-auto max-h-24 whitespace-pre-wrap">
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-2 px-4 py-1.5 border border-stone-600 text-stone-400 font-mono-retro text-xs tracking-wider hover:bg-stone-800 hover:text-stone-200 transition-colors cursor-pointer"
          >
            RETRY
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentView, setCurrentView] = useState<ScreenView>('GAME');
  const [isFullscreen, setIsFullscreen] = useState(false);
  // 界面切换过渡状态：用于优化切换动画，避免遮罩重叠
  const [isTransitioning, setIsTransitioning] = useState(false);

  // 优化的视图切换函数：先淡出旧界面，再切换到新界面
  const switchView = useCallback(
    (newView: ScreenView) => {
      if (currentView === newView) return;

      setIsTransitioning(true);
      // 快速淡出当前界面（100ms）
      setTimeout(() => {
        setCurrentView(newView);
        setIsTransitioning(false);
      }, 100);
    },
    [currentView],
  );

  // ====== 语音配置弹窗 ======
  const [showVoiceConfig, setShowVoiceConfig] = useState(false);

  // ====== 预加载状态 ======
  const [showLoadingScreen, setShowLoadingScreen] = useState(false);
  const [preloadProgress, setPreloadProgress] = useState(() => getPreloadProgress());

  // 监听预加载进度
  useEffect(() => {
    const unsubscribe = onPreloadProgress(progress => {
      setPreloadProgress(progress);
      if (progress.phase === 'done' || progress.phase === 'error') {
        // 加载完成或出错后22秒后自动关闭
        setTimeout(() => setShowLoadingScreen(false), 2000);
      }
    });
    return unsubscribe;
  }, []);

  // ====== 读档 & Roll 状态 ======
  // 当前加载的楼层 ID（null 表示无尚未加载
  const [loadedMessageId, setLoadedMessageId] = useState<number | null>(null);
  // Roll 结果：纯前端内存管理，不触发酒馆楼层刷新
  // rollResults[0] 始终是原始楼层内容，后续为 generate 生成的新结果
  const rollResultsRef = useRef<string[]>([]);
  const [rollIndex, setRollIndex] = useState(0); // 当前查找看的 roll 结果索引
  const [rollCount, setRollCount] = useState(0); // roll 结果总数（（0 表示无无 roll）
  // 是否正在 Roll 中（防止重复触发）
  const [isRolling, setIsRolling] = useState(false);
  // 最新 assistant 楼层 ID（用于判断是否处于历史回看）
  const [latestAssistantMsgId, setLatestAssistantMsgId] = useState<number | null>(null);
  // 是否处于历史回看状态
  const isReviewingHistory =
    loadedMessageId !== null && latestAssistantMsgId !== null && loadedMessageId !== latestAssistantMsgId;
  // 分支截断确认弹窗
  const [showBranchConfirm, setShowBranchConfirm] = useState(false);
  const pendingInputRef = useRef<string | null>(null);

  // 资源配置状态（从世界书异步加载）
  const [resourceConfig, setResourceConfig] = useState<ResourceConfig>(RESOURCE_CONFIG);
  const [, setIsLoadingResources] = useState(true);

  // MVU 变量状态 - 用于角色属性面板
  const [characterData, setCharacterData] = useState<CharacterProfile>(() => ({
    ...SAMPLE_CHARACTER,
    avatarUrl: loadAvatarUrl(),
  }));

  // ====== 角色描述状态（由 [desc:] 指令驱动）======
  const [characterDescription, setCharacterDescription] = useState<string>(SAMPLE_CHARACTER.description);

  // ====== bg 世界状态（由 [bg:] 指令驱动，场景/威胁度/时间））======
  const [bgWorldState, setBgWorldState] = useState<BgWorldState>(DEFAULT_BG_WORLD_STATE);

  // ====== 段落级状态覆盖（由 [stat:] 指令驱动，临时覆盖 Status 面板显示）======
  const [displayOverrides, setDisplayOverrides] = useState<StatOverride[]>([]);

  // ====== 继承 BGM URL（从历史楼层回溯得到，传递给 GameInterface 在 mount 时播放）======
  const [inheritedBgmUrl, setInheritedBgmUrl] = useState<string>('');

  // ====== 继承背景（从历史楼层回溯得到，传递给 GameInterface 作为 computeAccumulatedState 初始值）======
  const [inheritedBg, setInheritedBg] = useState<BgFullState | null>(null);

  // ====== Roll MVU 缓存：每个 roll 结果对应一份临时解析的 MVU 数据 ======
  const rollMvuCacheRef = useRef<Map<number, Mvu.MvuData>>(new Map());

  // ====== MVU 底值加载：从指定楼层的前序楼层回溯查找 stat_data（不读取自身，因为自身是更新后的值）======
  const loadMvuForMessageId = useCallback(async (targetMessageId: number) => {
    try {
      await waitGlobalInitialized('Mvu');
      const LOOKBACK_LIMIT = 20;

      // 直接从前序楼层回溯查找?stat_data（跳过自身，自身的是更新后的总结值而非初始值）
      const searchStart = targetMessageId - 1;
      const searchFloor = Math.max(0, searchStart - LOOKBACK_LIMIT);

      // 等待前序楼层�?stat_data 可用（最新?3 2秒）
      if (targetMessageId > 0) {
        try {
          await waitUntil(
            () => {
              for (let id = targetMessageId - 1; id >= searchFloor; id--) {
                try {
                  const vars = Mvu.getMvuData({ type: 'message', message_id: id });
                  const sd = _.get(vars, 'stat_data');
                  if (sd && Object.keys(sd).length > 0) return true;
                } catch {
                  // ignore
                }
              }
              return false;
            },
            { timeout: 3000, intervalBetweenAttempts: 200 },
          );
        } catch {
          console.warn('[wasteland-echoes-ui] 等待前序 stat_data 超时');
        }
      }

      // 回溯查找
      let statData: Record<string, any> | undefined;
      for (let id = targetMessageId - 1; id >= searchFloor; id--) {
        try {
          const vars = Mvu.getMvuData({ type: 'message', message_id: id });
          const sd = _.get(vars, 'stat_data');
          if (sd && Object.keys(sd).length > 0) {
            statData = sd;
            break;
          }
        } catch {
          // ignore
        }
      }

      if (statData) {
        setCharacterData(prev => buildCharacterFromMvu(statData!, prev));
      }
    } catch (e) {
      console.warn('[wasteland-echoes-ui] MVU 底值加载失�?', e);
    }
  }, []);

  // 监听 MVU 变量更新事件，实时刷新面板
  useEffect(() => {
    let cancelled = false;

    async function setupMvuListener() {
      try {
        await waitGlobalInitialized('Mvu');
        eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, (newVars: Mvu.MvuData) => {
          if (cancelled) return;
          const newStatData = _.get(newVars, 'stat_data');
          if (newStatData) {
            setCharacterData(prev => buildCharacterFromMvu(newStatData, prev));
          }
          setDisplayOverrides([]);
        });
      } catch (e) {
        console.warn('[wasteland-echoes-ui] MVU 事件监听设置失败:', e);
      }
    }

    setupMvuListener();
    return () => {
      cancelled = true;
    };
  }, []);

  // ====== Roll MVU 预览：临时解析消息内容中的 MVU 命令并更新状态面板 ======
  const previewMvuForContent = useCallback(
    async (content: string, rollIdx: number) => {
      try {
        await waitGlobalInitialized('Mvu');
        // 检查缓存
        const cached = rollMvuCacheRef.current.get(rollIdx);
        if (cached) {
          const statData = _.get(cached, 'stat_data');
          if (statData) {
            setCharacterData(prev => buildCharacterFromMvu(statData, prev));
          }
          // 修复漏洞 C：Roll预览时清除了段落覆盖，避免与旧覆盖混合
          setDisplayOverrides([]);
          return cached;
        }
        // 获取当前楼层的基础变量作为解析起点
        const messageId = loadedMessageId ?? getCurrentMessageId();
        const oldData = Mvu.getMvuData({ type: 'message', message_id: messageId });
        const newData = await Mvu.parseMessage(content, oldData);
        // 缓存结果
        rollMvuCacheRef.current.set(rollIdx, newData);
        // 更新面板
        const statData = _.get(newData, 'stat_data');
        if (statData) {
          setCharacterData(prev => buildCharacterFromMvu(statData, prev));
        }
        // 修复漏洞 C：Roll预览时清除了段落覆盖，显示纯净的Roll结果
        setDisplayOverrides([]);
        return newData;
      } catch (e) {
        console.warn('[wasteland-echoes-ui] Roll MVU 预览失败:', e);
        return null;
      }
    },
    [loadedMessageId],
  );

  // 从世界书异步加载资源映射
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const config = await loadResourceConfig();
        if (!cancelled) {
          // 合并：世界书配置优先，代码配置作�?fallback
          setResourceConfig(prev => {
            const merged = {
              characters: { ...prev.characters, ...config.characters },
              backgrounds: { ...prev.backgrounds, ...config.backgrounds },
              bgm: { ...prev.bgm, ...config.bgm },
              cg: { ...prev.cg, ...config.cg },
              characterAppearances: { ...prev.characterAppearances, ...config.characterAppearances },
              voices: config.voices || prev.voices, // 合并语音配置
            };
            // 清除了去重标记，允�?loadFromMessageId 用新的资源配置重新加�?            lastLoadedMsgIdRef.current = null;

            // 始终显示加载界面并执行预加载（背景和立绘始终预加载）
            const cgSettings = loadCGSettings();
            setShowLoadingScreen(true);
            // 延迟一帧，确保 LoadingScreen 已经渲染
            setTimeout(() => {
              startPreload(merged, cgSettings.preloadEnabled ?? false, merged.voices?.preloadEnabled ?? false).catch(
                err => {
                  console.error('[wasteland-echoes-ui] 预加载失败', err);
                },
              );
            }, 100);

            return merged;
          });
        }
      } catch (e) {
        console.warn('[wasteland-echoes-ui] 资源配置加载失败，使用默认值配�?', e);
      } finally {
        if (!cancelled) setIsLoadingResources(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // 从最新楼层动态读取 <ui> 内容并解析
  const [parsedScript, setParsedScript] = useState<ParsedScript>({ segments: [], skitLines: [] });
  // 记录已加载的 message_id，避免重复解析同一条消息
  const lastLoadedMsgIdRef = useRef<number | null>(null);

  // ====== 核心加载函数：从指定楼层加载 <ui> 内容和 MVU 变量 ======
  const loadFromMessageId = useCallback(
    (messageId: number) => {
      try {
        const messages = getChatMessages(messageId);
        const msg = messages.length > 0 ? messages[0] : null;
        if (!msg) {
          console.warn('[wasteland-echoes-ui] 楼层', messageId, '不存在');
          return;
        }

        const result = parseDialogueScript(msg.message);
        if (result.segments.length > 0) {
          setParsedScript(result);
          setLoadedMessageId(messageId);
          lastLoadedMsgIdRef.current = messageId;
          // 重置 roll 状态和 MVU 缓存：将当前楼层原始内容作为 rollResults[0]
          rollResultsRef.current = [msg.message];
          rollMvuCacheRef.current.clear();
          setRollIndex(0);
          setRollCount(0); // 0 表示无 roll，不显示导航
          // 修复漏洞 E：清除段落级覆盖，避免跳转后残留旧覆盖
          setDisplayOverrides([]);

          // 立即更新最新 assistant 楼层 ID，确保 isReviewingHistory 判断正确
          try {
            const lastMsgId = getLastMessageId();
            if (lastMsgId >= 0) {
              const searchStart = Math.max(0, lastMsgId - 50);
              const assistantMsgs = getChatMessages(`${searchStart}-${lastMsgId}`, { role: 'assistant' });
              if (assistantMsgs.length > 0) {
                const latestId = assistantMsgs[assistantMsgs.length - 1].message_id;
                setLatestAssistantMsgId(latestId);
              }
            }
          } catch {
            /* ignore */
          }

          // ====== 往前遍历历史楼层恢复最近的 [desc:]、[bg:] 和 [bgm:]（最多回溯 20 楼层，避免长聊天阻塞）======
          let foundDesc: string | null = null;
          let foundBgFull: BgFullState | null = null;
          let foundBgm: string | null = null; // BGM 名称（非 URL），null=未找到，''=显式停止
          const descSearchLimit = Math.max(0, messageId - 20);

          // 先从当前楼层提取 bg 状态（用于 bgWorldState 面板显示）
          const currentBgFull = extractLastBgFull(msg.message);
          if (currentBgFull) {
            foundBgFull = currentBgFull;
          }
          // 先从当前楼层提取 desc
          const currentDesc = extractLastDesc(msg.message);
          if (currentDesc) {
            foundDesc = currentDesc;
          }
          // 注意：不从当前楼层提取 bgm，因为当前楼层的 bgm 应该在段落推进时触发

          for (let id = messageId - 1; id >= descSearchLimit; id--) {
            if (foundDesc && foundBgFull && foundBgm !== null) break; // 三个都找到了就停止
            try {
              const histMsgs = getChatMessages(id);
              const histMsg = histMsgs.length > 0 ? histMsgs[0] : null;
              if (histMsg) {
                if (!foundDesc) {
                  const desc = extractLastDesc(histMsg.message);
                  if (desc) foundDesc = desc;
                }
                if (!foundBgFull) {
                  const bgFull = extractLastBgFull(histMsg.message);
                  if (bgFull) foundBgFull = bgFull;
                }
                if (foundBgm === null) {
                  const bgm = extractLastBgm(histMsg.message);
                  if (bgm !== null) foundBgm = bgm; // '' 表示显式停止，非空字符串表示 BGM
                }
              }
            } catch {
              /* ignore */
            }
          }
          if (foundDesc) {
            setCharacterDescription(foundDesc);
          } else {
            setCharacterDescription(SAMPLE_CHARACTER.description);
          }
          if (foundBgFull) {
            setBgWorldState({ 场景: foundBgFull.场景, 威胁度等级: foundBgFull.威胁度等级, 时间: foundBgFull.时间 });
          } else {
            setBgWorldState(DEFAULT_BG_WORLD_STATE);
          }
          // bg 继承：始终从前面楼层回溯 bg 作为 computeAccumulatedState 的初始值
          // 即使当前楼层有 [bg:]，它可能不在第一个段落，继承值确保段落0 就有背景
          // 当前楼层的 [bg:] 在扫描到对应段落时会自然覆盖继承值
          {
            let inheritBgFull: BgFullState | null = null;
            for (let id = messageId - 1; id >= descSearchLimit; id--) {
              if (inheritBgFull) break;
              try {
                const histMsgs = getChatMessages(id);
                const histMsg = histMsgs.length > 0 ? histMsgs[0] : null;
                if (histMsg) {
                  const bgFull = extractLastBgFull(histMsg.message);
                  if (bgFull) inheritBgFull = bgFull;
                }
              } catch {
                /* ignore */
              }
            }
            if (inheritBgFull) {
              setInheritedBg(inheritBgFull);
            } else {
              setInheritedBg(null);
            }
          }
          // BGM 继承：只有从前面楼层回溯到有效 BGM 名称时才继承播放
          if (foundBgm && foundBgm.length > 0) {
            const bgmUrl = parserResolveBgmUrl(resourceConfig, foundBgm);
            setInheritedBgmUrl(bgmUrl);
          } else {
            setInheritedBgmUrl(''); // 无继承或显式停止
          }

          // ====== 加载该楼层对应的 MVU 底值 ======
          loadMvuForMessageId(messageId);
        }
      } catch (e) {
        console.warn('[wasteland-echoes-ui] 加载楼层', messageId, '失败:', e);
      }
    },
    [resourceConfig, loadMvuForMessageId],
  );

  // ====== 更新最新 assistant 楼层 ID ======
  const refreshLatestAssistantId = useCallback(() => {
    try {
      // 使用范围查询获取所有 assistant 消息，而非 -1（只返回最新一条）
      const lastId = getLastMessageId();
      if (lastId < 0) return;
      const searchStart = Math.max(0, lastId - 50);
      const msgs = getChatMessages(`${searchStart}-${lastId}`, { role: 'assistant' });
      if (msgs.length > 0) {
        const latestId = msgs[msgs.length - 1].message_id;
        setLatestAssistantMsgId(latestId);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const loadLatest = () => {
      try {
        // 向前查找最近的 assistant 消息（最多回溯 50 楼层）
        const lastId = getLastMessageId();
        if (lastId < 0) return;
        const searchStart = Math.max(0, lastId - 50);
        const allMessages = getChatMessages(`${searchStart}-${lastId}`, { role: 'assistant' });
        let lastMessage = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null;

        // 如果完全没有 assistant 消息，尝试读取最新消息（兼容无 assistant 的初始状态）
        if (!lastMessage) {
          const fallback = getChatMessages(-1);
          lastMessage = fallback.length > 0 ? fallback[fallback.length - 1] : null;
        }

        if (!lastMessage) return;

        // 更新最新 assistant ID
        refreshLatestAssistantId();

        // 去重：同一条消息不重复解析
        if (lastLoadedMsgIdRef.current === lastMessage.message_id) return;

        loadFromMessageId(lastMessage.message_id);
      } catch (e) {
        console.warn('[wasteland-echoes-ui] 加载聊天消息失败:', e);
      }
    };

    // 初始加载
    loadLatest();

    // 监听新消息到达和聊天切换事件，自动更新显示
    const onMessageReceived = () => {
      setTimeout(() => {
        loadLatest();
        // 自动触发 CG 生成（仅最新楼层，内部通过内容哈希判断是否需要重新生成）
        setTimeout(() => {
          try {
            const cgSettings = loadCGSettings();
            if (!cgSettings.enabled) return;
            // 获取最新 assistant 楼层
            const lastId = getLastMessageId();
            if (lastId < 0) return;
            const searchStart = Math.max(0, lastId - 50);
            const msgs = getChatMessages(`${searchStart}-${lastId}`, { role: 'assistant' });
            if (msgs.length === 0) return;
            const latestMsg = msgs[msgs.length - 1];
            // 解析段落文本
            const result = parseDialogueScript(latestMsg.message);
            if (result.segments.length === 0) return;
            const paragraphs = result.segments.map(s => s.text);
            // 触发 CG 生成（异步，不阻塞 UI；内部会通过内容哈希判断是否跳过）
            triggerCGGeneration(paragraphs, latestMsg.message_id, resourceConfig.characterAppearances)
              .then(() => {
                // 生成完成后自动清理旧缓存
                autoCleanCache(50).catch(e => console.warn('[wasteland-echoes-ui] 自动清理缓存失败:', e));
              })
              .catch(e => {
                console.warn('[wasteland-echoes-ui] 自动 CG 生成失败:', e);
              });
          } catch (e) {
            console.warn('[wasteland-echoes-ui] 自动 CG 触发检查失败', e);
          }
        }, 500); // 延迟 500ms 等 MVU 变量落盘
      }, 100); // 延迟确保消息已写入
    };

    // 监听消息编辑事件：强制重新加载（绕过去重），确保编辑后 BGM 等指令生效
    const onMessageEdited = () => {
      setTimeout(() => {
        // 清除去重标记，强制重新解析
        lastLoadedMsgIdRef.current = null;
        loadLatest();
      }, 100);
    };

    const msgListener = eventOn(tavern_events.MESSAGE_RECEIVED, onMessageReceived);
    const chatListener = eventOn(tavern_events.CHAT_CHANGED, onMessageReceived);
    const editListener = eventOn(tavern_events.MESSAGE_EDITED, onMessageEdited);

    return () => {
      msgListener.stop();
      chatListener.stop();
      editListener.stop();
    };
  }, [loadFromMessageId, refreshLatestAssistantId]);

  // ====== 读档跳转 ======
  const handleLoadMessage = useCallback(
    (messageId: number) => {
      // 先刷新最新 assistant ID，确保 isReviewingHistory 判断正确
      refreshLatestAssistantId();
      loadFromMessageId(messageId);
      switchView('GAME');
    },
    [loadFromMessageId, refreshLatestAssistantId, switchView],
  );

  // ====== 截断删除：删除指定楼层及之后所有楼层?======
  const handleDeleteFromMessage = useCallback(
    async (messageId: number) => {
      try {
        const lastId = getLastMessageId();
        const idsToDelete = _.range(messageId, lastId + 1);
        if (idsToDelete.length === 0) return;

        await deleteChatMessages(idsToDelete, { refresh: 'none' });

        // 清理被删除楼层的 CG 缓存
        clearFloorCGCache(messageId).catch(e => {
          console.warn('[wasteland-echoes-ui] 清理 CG 缓存失败:', e);
        });

        // 刷新最新?assistant ID
        refreshLatestAssistantId();

        // 如果当前加载的楼层被删除了，回退到删除前最新近的 assistant 楼层
        if (loadedMessageId !== null && loadedMessageId >= messageId) {
          const newLastId = getLastMessageId();
          if (newLastId >= 0) {
            const msgs = getChatMessages(-1, { role: 'assistant' });
            if (msgs.length > 0) {
              loadFromMessageId(msgs[msgs.length - 1].message_id);
            } else {
              // 没有 assistant 楼层了，重置状态?              setLoadedMessageId(null);
              setParsedScript({ segments: [], skitLines: [] });
            }
          } else {
            setLoadedMessageId(null);
            setParsedScript({ segments: [], skitLines: [] });
          }
        }
      } catch (e) {
        console.error('[wasteland-echoes-ui] 截断删除失败:', e);
        throw e;
      }
    },
    [loadedMessageId, loadFromMessageId, refreshLatestAssistantId],
  );

  // ====== Roll (纯前端内存管�? ======
  // generate 生成新回复，结果存入 rollResultsRef，切换只更新 parsedScript
  const rollGenerationIdRef = useRef<string | null>(null);

  const handleRoll = useCallback(async () => {
    // 如果正在 Roll，再次点击则打断
    if (isRolling) {
      if (rollGenerationIdRef.current) {
        stopGenerationById(rollGenerationIdRef.current);
      }
      return;
    }
    if (loadedMessageId === null) return;
    setIsRolling(true);
    const genId = `roll-${Date.now()}`;
    rollGenerationIdRef.current = genId;
    try {
      // 临时隐藏 loadedMessageId 及其之后的所有楼层，�?generate 的聊天历�?      // 截止到该楼层之前（模拟酒馆原�?swipe �?同层重新生成"行为�?      const lastMsgId = getLastMessageId();
      const idsToHide: number[] = [];
      for (let i = loadedMessageId; i <= lastMsgId; i++) {
        idsToHide.push(i);
      }
      await setChatMessages(
        idsToHide.map(id => ({ message_id: id, is_hidden: true })),
        { refresh: 'none' },
      );

      let newContent: string;
      try {
        newContent = await generate({ user_input: '', generation_id: genId });
      } finally {
        // 无论成功失败，都恢复所有被隐藏楼层的可见性
        await setChatMessages(
          idsToHide.map(id => ({ message_id: id, is_hidden: false })),
          { refresh: 'none' },
        );
      }
      rollGenerationIdRef.current = null;
      if (!newContent) {
        console.warn('[wasteland-echoes-ui] Roll 生成结果为空');
        setIsRolling(false);
        return;
      }
      // 追加到内存结果列表
      rollResultsRef.current.push(newContent);
      const newIndex = rollResultsRef.current.length - 1;
      setRollIndex(newIndex);
      setRollCount(rollResultsRef.current.length);
      // 解析并显示新结果（空 segments 说明 AI 输出不含有效 <ui> 内容，保留旧显示并提示）
      const result = parseDialogueScript(newContent);
      if (result.segments.length > 0) {
        setParsedScript(result);
      } else {
        console.warn('[wasteland-echoes-ui] Roll 生成结果解析为空 segments，保留当前显示');
      }
      // 临时解析 MVU 变量并更新状态面板
      await previewMvuForContent(newContent, newIndex);
      setIsRolling(false);
    } catch (e) {
      rollGenerationIdRef.current = null;
      // 确保异常时也恢复楼层可见性
      try {
        const lastMsgId = getLastMessageId();
        const restoreIds: number[] = [];
        for (let i = loadedMessageId; i <= lastMsgId; i++) {
          restoreIds.push(i);
        }
        await setChatMessages(
          restoreIds.map(id => ({ message_id: id, is_hidden: false })),
          { refresh: 'none' },
        );
      } catch {
        /* ignore */
      }
      console.error('[wasteland-echoes-ui] Roll 失败:', e);
      setIsRolling(false);
    }
  }, [isRolling, loadedMessageId, previewMvuForContent]);

  // Roll 结果切换（纯前端，不碰酒馆楼层）
  const handleSwipeNav = useCallback(
    (direction: 'prev' | 'next') => {
      const total = rollResultsRef.current.length;
      if (total <= 1) return;
      const newIndex = direction === 'next' ? Math.min(rollIndex + 1, total - 1) : Math.max(rollIndex - 1, 0);
      if (newIndex === rollIndex) return;
      setRollIndex(newIndex);
      // 解析对应结果
      const content = rollResultsRef.current[newIndex];
      const result = parseDialogueScript(content);
      if (result.segments.length > 0) {
        setParsedScript(result);
      }
      // 切换时也更新 MVU 预览
      // index=0 是原始楼层内容，直接从楼层读取已有变量而非重新解析（避免增量叠加）
      if (newIndex === 0) {
        try {
          const messageId = loadedMessageId ?? getCurrentMessageId();
          const vars = Mvu.getMvuData({ type: 'message', message_id: messageId });
          const statData = _.get(vars, 'stat_data');
          if (statData) {
            setCharacterData(prev => buildCharacterFromMvu(statData, prev));
          }
        } catch {
          /* ignore */
        }
      } else {
        previewMvuForContent(content, newIndex);
      }
    },
    [rollIndex, previewMvuForContent, loadedMessageId],
  );

  // ====== 选定 Roll 结果并写回酒馆楼层（发送前调用�?=====
  const commitRollResult = useCallback(async () => {
    if (loadedMessageId === null || rollCount <= 1) return;
    const selectedContent = rollResultsRef.current[rollIndex];
    try {
      // 将选中的结果写回酒馆楼层（不刷新显示，避免 iframe 重载�?      await setChatMessages([{ message_id: loadedMessageId, message: selectedContent }], { refresh: 'none' });

      // 如果处于历史回看状态，删除后续为楼层（分支截断）
      const lastId = getLastMessageId();
      if (lastId > loadedMessageId) {
        const idsToDelete = _.range(loadedMessageId + 1, lastId + 1);
        await deleteChatMessages(idsToDelete, { refresh: 'none' });
        refreshLatestAssistantId();
      }

      // 将选中�?MVU 变量持久化写回楼层?      const cachedMvu = rollMvuCacheRef.current.get(rollIndex);
      if (cachedMvu) {
        try {
          await waitGlobalInitialized('Mvu');
          await Mvu.replaceMvuData(cachedMvu, { type: 'message', message_id: loadedMessageId });
        } catch (mvuErr) {
          console.warn('[wasteland-echoes-ui] Roll MVU 持久化失�?', mvuErr);
        }
      }

      // ====== 新增：选定 Roll 后自动触�?CG 生成 ======
      try {
        const cgSettings = loadCGSettings();
        if (cgSettings.enabled) {
          // 解析选定的 roll 结果
          const result = parseDialogueScript(selectedContent);
          if (result.segments.length > 0) {
            const paragraphs = result.segments.map(s => s.text);
            // 触发 CG 生成（异步，不阻塞；强制重新生成以反映新内容）
            triggerCGGeneration(paragraphs, loadedMessageId, resourceConfig.characterAppearances, true)
              .then(() => {
                autoCleanCache(50).catch(e => console.warn('[wasteland-echoes-ui] 自动清理缓存失败:', e));
              })
              .catch(e => {
                console.warn('[wasteland-echoes-ui] Roll 后 CG 生成失败:', e);
              });
          }
        }
      } catch (e) {
        console.warn('[wasteland-echoes-ui] Roll 后 CG 触发检查失败', e);
      }

      // 重置 roll 状态和 MVU 缓存
      rollResultsRef.current = [selectedContent];
      rollMvuCacheRef.current.clear();
      setRollIndex(0);
      setRollCount(0);
    } catch (e) {
      console.warn('[wasteland-echoes-ui] 写回 Roll 结果失败:', e);
    }
  }, [loadedMessageId, rollIndex, rollCount, refreshLatestAssistantId, resourceConfig]);

  // ====== 段落跳转（LOG 细跳转用�?=====
  const [jumpToIndex, setJumpToIndex] = useState<number | null>(null);

  // ====== AI 生成状态?======
  const [isGenerating, setIsGenerating] = useState(false);

  // ====== 核心发�?生成函数：用 generate 接管，不触发 DOM 刷新 ======
  const sendAndGenerate = useCallback(
    async (text: string) => {
      setIsGenerating(true);
      try {
        // 1. 先将选中�?Roll 结果写回酒馆楼层
        await commitRollResult();

        // 2. 静默写入 user 楼层（不触发 DOM 刷新，避免外部脚本移除了界面板）
        await createChatMessages([{ role: 'user', message: text }], { refresh: 'none' });

        // 3. �?generate 请求 AI 生成（携带完整聊天历史，包括刚写入的 user 楼层�?        const result = await generate({ user_input: '' });

        if (!result) {
          console.warn('[wasteland-echoes-ui] AI 生成结果为空');
          return;
        }

        // 4. 静默写入 assistant 楼层
        await createChatMessages([{ role: 'assistant', message: result }], { refresh: 'none' });

        // 5. 解析并更新界面显示（无缝切换到新内容�?        const parsed = parseDialogueScript(result);
        if (parsed.segments.length > 0) {
          setParsedScript(parsed);
          // 更新 loadedMessageId �?roll 状态?          const newMsgId = getLastMessageId();
          setLoadedMessageId(newMsgId);
          lastLoadedMsgIdRef.current = newMsgId;
          rollResultsRef.current = [result];
          setRollIndex(0);
          setRollCount(0);
          refreshLatestAssistantId();
        }

        // 6. 手动处理 MVU 变量更新
        try {
          await waitGlobalInitialized('Mvu');
          const newMsgIdForMvu = getLastMessageId();
          const oldData = Mvu.getMvuData({ type: 'message', message_id: newMsgIdForMvu });
          const newData = await Mvu.parseMessage(result, oldData);
          await Mvu.replaceMvuData(newData, { type: 'message', message_id: newMsgIdForMvu });
          // 刷新面板显示
          await loadMvuForMessageId(newMsgIdForMvu);
        } catch (mvuErr) {
          console.warn('[wasteland-echoes-ui] MVU 变量更新失败（可能未启用 MVU�?', mvuErr);
        }
      } catch (e) {
        console.error('[wasteland-echoes-ui] 发�?生成失败:', e);
      } finally {
        setIsGenerating(false);
      }
    },
    [commitRollResult, refreshLatestAssistantId, loadMvuForMessageId],
  );

  // ====== 发送用户输入（带分支截断确认）======
  const handleSendUserInput = useCallback(
    async (text: string) => {
      if (isGenerating) return; // 防止止生成期间重复发�?
      // 实时计算是否处于历史回看状态（不依赖可能滞后的 React state�?      let isHistoryNow = false;
      if (loadedMessageId !== null) {
        try {
          const lastMsgId = getLastMessageId();
          if (lastMsgId >= 0) {
            const searchStart = Math.max(0, lastMsgId - 50);
            const assistantMsgs = getChatMessages(`${searchStart}-${lastMsgId}`, { role: 'assistant' });
            if (assistantMsgs.length > 0) {
              const latestAssistantId = assistantMsgs[assistantMsgs.length - 1].message_id;
              isHistoryNow = loadedMessageId !== latestAssistantId;
            }
          }
        } catch {
          /* ignore */
        }
      }

      if (isHistoryNow) {
        // 历史回看状态：弹出确认弹窗
        pendingInputRef.current = text;
        setShowBranchConfirm(true);
        return;
      }
      await sendAndGenerate(text);
    },
    [isGenerating, loadedMessageId, sendAndGenerate],
  );

  // Default Settings - 从全局变量恢复持久化设置
  const DEFAULT_SETTINGS: GameSettings = {
    autoPlay: false,
    speed: 1,
    volumeMusic: 0.2,
    volumeSfx: 0.6,
    volumeVoice: 0.8,
    brightness: 100,
  };
  const [settings, setSettings] = useState<GameSettings>(() => {
    try {
      const saved = getVariables({ type: 'global' }) as Record<string, any>;
      const s = saved?.wasteland_echoes_settings;
      if (s && typeof s === 'object') {
        return {
          autoPlay: typeof s.autoPlay === 'boolean' ? s.autoPlay : DEFAULT_SETTINGS.autoPlay,
          speed: typeof s.speed === 'number' ? s.speed : DEFAULT_SETTINGS.speed,
          volumeMusic: typeof s.volumeMusic === 'number' ? s.volumeMusic : DEFAULT_SETTINGS.volumeMusic,
          volumeSfx: typeof s.volumeSfx === 'number' ? s.volumeSfx : DEFAULT_SETTINGS.volumeSfx,
          volumeVoice: typeof s.volumeVoice === 'number' ? s.volumeVoice : DEFAULT_SETTINGS.volumeVoice,
          brightness: typeof s.brightness === 'number' ? s.brightness : DEFAULT_SETTINGS.brightness,
        };
      }
    } catch (e) {
      console.warn('[wasteland-echoes-ui] 读取持久化设置失败，使用默认值?', e);
    }
    return DEFAULT_SETTINGS;
  });

  // 设置变更时持久化到全局变量
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  useEffect(() => {
    try {
      const vars = (getVariables({ type: 'global' }) as Record<string, any>) || {};
      vars.wasteland_echoes_settings = {
        volumeMusic: settings.volumeMusic,
        volumeSfx: settings.volumeSfx,
        volumeVoice: settings.volumeVoice,
        brightness: settings.brightness,
      };
      replaceVariables(vars, { type: 'global' });
    } catch (e) {
      console.warn('[wasteland-echoes-ui] 持久化设置失�?', e);
    }
  }, [settings.volumeMusic, settings.volumeSfx, settings.volumeVoice, settings.brightness]);

  // Audio Refs
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const sfxRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const hasInteractedRef = useRef(false);
  const bgmGenRef = useRef(0); // BGM generation counter to prevent play/pause race conditions

  // ====== 多楼层 BGM 去重：只有最新的前端界面楼层才允许播放音频 ======
  const isLatestUiFloorRef = useRef(false);

  useEffect(() => {
    // 检测当前 iframe 是否是最新的前端界面楼层
    const checkIsLatest = () => {
      try {
        const myMsgId = getCurrentMessageId();
        // 查找所有含前端界面 iframe 的楼层
        const $uiMes = (window.parent as any)
          .$('#chat > .mes')
          .filter((_: number, el: HTMLElement) => (window.parent as any).$(el).find('iframe[srcdoc]').length > 0);
        if ($uiMes.length === 0) {
          isLatestUiFloorRef.current = true;
          return;
        }
        const lastMesId = Number($uiMes.last().attr('mesid'));
        isLatestUiFloorRef.current = myMsgId === lastMesId;
      } catch {
        // 如果检测失败，默认允许播放（兼容性）
        isLatestUiFloorRef.current = true;
      }
    };

    checkIsLatest();

    // 监听楼层可见性变化：被隐藏时暂停 BGM，重新显示时恢复
    const myIframe = window.frameElement as HTMLElement | null;
    const myMes = myIframe?.closest?.('.mes') as HTMLElement | null;
    let visibilityObserver: MutationObserver | null = null;

    if (myMes) {
      visibilityObserver = new MutationObserver(() => {
        const isHidden = getComputedStyle(myMes).display === 'none';
        if (isHidden && bgmRef.current && !bgmRef.current.paused) {
          bgmRef.current.pause();
        }
      });
      visibilityObserver.observe(myMes, { attributes: true, attributeFilter: ['style'] });
    }

    // 监听新消息到达时重新检测是否为最新楼层
    const recheckListener = eventOn(tavern_events.MESSAGE_RECEIVED, () => {
      const wasLatest = isLatestUiFloorRef.current;
      checkIsLatest();
      // 如果从最新变为非最新，暂停 BGM
      if (wasLatest && !isLatestUiFloorRef.current && bgmRef.current && !bgmRef.current.paused) {
        bgmRef.current.pause();
      }
    });

    return () => {
      visibilityObserver?.disconnect();
      recheckListener.stop();
    };
  }, []);

  // Initialize SFX Audio
  useEffect(() => {
    if (AUDIO_ASSETS.click) {
      sfxRef.current = new Audio(AUDIO_ASSETS.click);
      sfxRef.current.volume = settings.volumeSfx;
    }

    return () => {
      if (bgmRef.current) {
        bgmRef.current.pause();
        bgmRef.current = null;
      }
      if (sfxRef.current) sfxRef.current = null;
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, []);

  // Update Volume when settings change
  useEffect(() => {
    if (bgmRef.current) bgmRef.current.volume = settings.volumeMusic;
    if (sfxRef.current) sfxRef.current.volume = settings.volumeSfx;
  }, [settings.volumeMusic, settings.volumeSfx]);

  // Handle "First Click" to start BGM (Browser Autoplay Policy)
  useEffect(() => {
    const startAudioContext = () => {
      const bgm = bgmRef.current;
      if (!hasInteractedRef.current && bgm && isLatestUiFloorRef.current) {
        hasInteractedRef.current = true;
        // �?0 渐入播放（~42秒渐入）
        bgm.volume = 0;
        const gen = bgmGenRef.current; // snapshot current generation
        bgm
          .play()
          .then(() => {
            if (bgmGenRef.current !== gen || bgmRef.current !== bgm) return;
            const fadeIn = setInterval(() => {
              if (bgmGenRef.current !== gen || bgmRef.current !== bgm) {
                clearInterval(fadeIn);
                return;
              }
              if (bgm.volume < settings.volumeMusic - 0.02) {
                bgm.volume = Math.min(settings.volumeMusic, bgm.volume + 0.02);
              } else {
                bgm.volume = settings.volumeMusic;
                clearInterval(fadeIn);
              }
            }, 80);
          })
          .catch(e => {
            if (e.name === 'AbortError') return; // interrupted by a newer BGM switch, safe to ignore
          });
      }
    };

    window.addEventListener('click', startAudioContext);
    window.addEventListener('keydown', startAudioContext);

    return () => {
      window.removeEventListener('click', startAudioContext);
      window.removeEventListener('keydown', startAudioContext);
    };
  }, [settings.volumeMusic]);

  // Helper to play SFX
  const playSfx = () => {
    // 优先使用外部音频文件
    if (sfxRef.current) {
      sfxRef.current.currentTime = 0;
      sfxRef.current.play().catch(() => {});
      return;
    }
    // Fallback: Web Audio API 合成清脆点击音效
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;
      const now = ctx.currentTime;
      const vol = settings.volumeSfx;

      // 白噪声脉冲（模拟清脆�?�?声）
      const bufferSize = Math.floor(ctx.sampleRate * 0.015); // 15ms
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        // 快速衰减的白噪�?        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;

      // 高通滤波让噪声更清�?      const hpFilter = ctx.createBiquadFilter();
      hpFilter.type = 'highpass';
      hpFilter.frequency.value = 3000;

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(vol * 0.6, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);

      noise.connect(hpFilter).connect(noiseGain).connect(ctx.destination);
      noise.start(now);
      noise.stop(now + 0.015);

      // 高频正弦音（增加"�?的质感）
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(4500, now);
      osc.frequency.exponentialRampToValueAtTime(2000, now + 0.02);

      const oscGain = ctx.createGain();
      oscGain.gain.setValueAtTime(vol * 0.2, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);

      osc.connect(oscGain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.02);
    } catch {
      // AudioContext 不可用时静默忽略
    }
  };

  // BGM change handler (called by GameInterface when [bgm:xxx] triggers)
  const handleBgmChange = useCallback(
    (url: string) => {
      if (!url) return;

      // 多楼层去重：只有最新的前端界面板楼层才允许播�?BGM
      if (!isLatestUiFloorRef.current) {
        return;
      }

      // If same BGM is already playing, do nothing
      if (bgmRef.current && bgmRef.current.src === url) return;

      // Bump generation so stale play() promises know they're outdated
      const gen = ++bgmGenRef.current;

      // Fade out old BGM (~3s)
      if (bgmRef.current) {
        const oldBgm = bgmRef.current;
        bgmRef.current = null; // detach immediately to prevent double-pause
        const fadeOut = setInterval(() => {
          if (oldBgm.volume > 0.02) {
            oldBgm.volume = Math.max(0, oldBgm.volume - 0.02);
          } else {
            clearInterval(fadeOut);
            oldBgm.pause();
            oldBgm.src = '';
          }
        }, 60);
      }

      // Create new BGM element but wait for it to be ready before playing
      const newBgm = new Audio(url);
      newBgm.loop = true;
      newBgm.volume = 0;
      newBgm.preload = 'auto';
      bgmRef.current = newBgm;

      // Wait for enough data to be buffered, then play �?avoids the
      // "play() interrupted by pause()" race that happens when play() is
      // called on an element whose source hasn't loaded yet and a new
      // BGM change arrives before the promise settles.
      const startPlayback = () => {
        // If another BGM change happened while we were waiting, bail out
        if (bgmGenRef.current !== gen) {
          newBgm.pause();
          newBgm.src = '';
          return;
        }

        newBgm
          .play()
          .then(() => {
            // Double-check we're still the active BGM after the async play resolves
            if (bgmGenRef.current !== gen) {
              newBgm.pause();
              newBgm.src = '';
              return;
            }
            const fadeIn = setInterval(() => {
              if (bgmGenRef.current !== gen) {
                clearInterval(fadeIn);
                return;
              }
              if (newBgm.volume < settings.volumeMusic - 0.02) {
                newBgm.volume = Math.min(settings.volumeMusic, newBgm.volume + 0.02);
              } else {
                newBgm.volume = settings.volumeMusic;
                clearInterval(fadeIn);
              }
            }, 80);
          })
          .catch(e => {
            if (e.name === 'AbortError') {
              // play() was interrupted �?this is expected during rapid BGM switches, safe to ignore
              return;
            }
            console.warn('BGM play failed:', e);
            hasInteractedRef.current = false;
          });
      };

      // If the browser already has enough data, play immediately;
      // otherwise wait for the 'canplaythrough' event.
      if (newBgm.readyState >= 3) {
        startPlayback();
      } else {
        newBgm.addEventListener('canplaythrough', startPlayback, { once: true });
      }
    },
    [settings.volumeMusic],
  );

  const handleToggleSetting = (key: keyof GameSettings) => {
    setSettings(prev => {
      if (key === 'speed') {
        return { ...prev, speed: prev.speed === 1 ? 2 : 1 };
      }
      if (typeof prev[key] === 'boolean') {
        return { ...prev, [key]: !prev[key] };
      }
      return prev;
    });
  };

  const handleUpdateSetting = (key: keyof GameSettings, value: number) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  // ====== 收集条目持久化到角色卡变�?======
  const handleCollectionChange = useCallback((collections: CollectionEntry[]) => {
    try {
      const charVars = getVariables({ type: 'character' }) as Record<string, any>;
      const existing: { 标题: string; 描述: string }[] = charVars?.收集?.结局 ?? [];
      const existingTitles = new Set(existing.map(e => e.标题));
      let changed = false;
      for (const c of collections) {
        if (c.type === '结局' && !existingTitles.has(c.title)) {
          existing.push({ 标题: c.title, 描述: c.desc });
          existingTitles.add(c.title);
          changed = true;
        }
      }
      if (changed) {
        replaceVariables({ ...charVars, 收集: { ...(charVars.收集 || {}), 结局: existing } }, { type: 'character' });
      }
    } catch (e) {
      console.error('[wasteland-echoes-ui] 收集条目持久化失�?', e);
    }
  }, []);

  // ====== 保存语音配置 ======
  const handleSaveVoiceConfig = useCallback(async (config: any) => {
    try {
      // 查找语音配置所在的世界书和条目
      const charWorldbooks = getCharWorldbookNames('current');
      const worldbookNames: string[] = [];

      if (charWorldbooks.primary) {
        worldbookNames.push(charWorldbooks.primary);
      }
      worldbookNames.push(...charWorldbooks.additional);

      const globalNames = getGlobalWorldbookNames();
      worldbookNames.push(...globalNames);

      const uniqueNames = [...new Set(worldbookNames)];

      let targetWorldbook: string | null = null;
      let targetEntryUid: number | null = null;

      // 查找现有的语音配置条目
      for (const wbName of uniqueNames) {
        try {
          const entries = await getWorldbook(wbName);
          const voiceEntry = entries.find(
            entry => entry.name === '[res]角色语音' || entry.name.includes('角色语音') || entry.name.includes('voices'),
          );
          if (voiceEntry) {
            targetWorldbook = wbName;
            targetEntryUid = voiceEntry.uid;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      // 如果没有找到现有条目，在第一个可用的世界书中创建新条目
      if (!targetWorldbook && uniqueNames.length > 0) {
        targetWorldbook = uniqueNames[0];
      }

      if (!targetWorldbook) {
        throw new Error('没有可用的世界书来保存语音配置');
      }

      // 将配置转换为 JSON 字符串
      const configJson = JSON.stringify(config, null, 2);

      // 更新或创建世界书条目
      await updateWorldbookWith(targetWorldbook, worldbook => {
        if (targetEntryUid !== null) {
          // 更新现有条目
          const entry = worldbook.find(e => e.uid === targetEntryUid);
          if (entry) {
            entry.content = configJson;
          }
        } else {
          // 创建新条目
          worldbook.push({
            uid: Math.max(0, ...worldbook.map(e => e.uid)) + 1,
            name: '[res]角色语音',
            enabled: false, // 关闭以避免发给 AI
            content: configJson,
            strategy: {
              type: 'constant',
              keys: [],
              keys_secondary: { logic: 'and_any', keys: [] },
              scan_depth: 'same_as_global',
            },
            position: {
              type: 'after_character_definition',
              role: 'system',
              depth: 4,
              order: 100,
            },
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
          });
        }
        return worldbook;
      });

      // 更新本地状态
      setResourceConfig(prev => ({ ...prev, voices: config }));

      console.info(`[wasteland-echoes-ui] 语音配置已保存到世界书 "${targetWorldbook}"`);
    } catch (e) {
      console.error('[wasteland-echoes-ui] 语音配置保存失败:', e);
      throw e;
    }
  }, []);

  const toggleFullScreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    if (!document.fullscreenElement) {
      el.requestFullscreen()
        .then(() => {
          // 移动端进入全屏后尝试锁定为横屏方�?          // Screen Orientation API 仅在全屏状态下可用
          const orientation = (screen as any).orientation;
          if (orientation && typeof orientation.lock === 'function') {
            orientation.lock('landscape').catch((err: Error) => {
              // 桌面板端、iOS Safari 不支持锁定，静默忽略
              console.info('[quiet-editor-ui] 屏幕方向锁定不可�?', err.message);
            });
          }
        })
        .catch(err => {
          console.warn('Error attempting to enable full-screen mode:', err);
        });
    } else if (document.exitFullscreen) {
      // 退出全屏前先解锁方�?      const orientation = (screen as any).orientation;
      if (orientation && typeof orientation.unlock === 'function') {
        try {
          orientation.unlock();
        } catch {
          /* ignore */
        }
      }
      document.exitFullscreen();
    }
  }, []);

  // 监听全屏状态变化
  useEffect(() => {
    const handleFullscreenChange = () => {
      const inFullscreen = !!document.fullscreenElement;
      setIsFullscreen(inFullscreen);
      if (!inFullscreen && containerRef.current) {
        void containerRef.current.offsetHeight;
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Ctrl+F11 全屏快捷键（全局监听）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'F11') {
        e.preventDefault();
        toggleFullScreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleFullScreen]);

  // 如果没有解析到任何段落，显示提示
  if (parsedScript.segments.length === 0) {
    return (
      <div className="relative w-full h-full overflow-hidden bg-stone-950 flex items-center justify-center">
        <div className="text-stone-500 font-mono-retro text-sm text-center p-8">
          <p>NO_DATA_FOUND</p>
          <p className="text-xs mt-2 text-stone-600">{'未在消息中检测到 <ui>...</ui> 内容'}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-[var(--color-cozy-bg)] font-sans selection:bg-[#ddb8b0] selection:text-white"
    >
      {/* Global Texture Overlay */}
      <NoiseOverlay />

      {/* Brightness Control Overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-[100] bg-black transition-opacity duration-300"
        style={{ opacity: Math.max(0, 0.45 - settings.brightness / 220) }}
      />

      {/* Vignette �?改为极轻，避免主界面板整体发暗 */}
      <div className="pointer-events-none absolute inset-0 z-40 bg-[radial-gradient(circle_at_center,transparent_58%,rgba(0,0,0,0.04)_78%,rgba(0,0,0,0.1)_100%)]" />

      {/* Content Area */}
      <div className="w-full h-full relative z-10">
        <GameErrorBoundary>
          <GameInterface
            settings={settings}
            onToggleSetting={handleToggleSetting}
            onShowLog={() => switchView('LOG')}
            onShowStatus={() => switchView('STATUS')}
            onShowSettings={() => switchView('SETTINGS')}
            onShowCGConfig={() => switchView('CG_CONFIG')}
            onShowVoiceConfig={() => setShowVoiceConfig(true)}
            onShowSaveLoad={() => switchView('SAVE_LOAD')}
            onShowCollection={() => switchView('COLLECTION')}
            onShowRelationship={() => switchView('RELATIONSHIP')}
            onToggleFullscreen={toggleFullScreen}
            isFullscreen={isFullscreen}
            playSfx={playSfx}
            onBgmChange={handleBgmChange}
            inheritedBgmUrl={inheritedBgmUrl}
            inheritedBg={inheritedBg}
            segments={parsedScript.segments}
            resourceConfig={resourceConfig}
            onRoll={handleRoll}
            isRolling={isRolling}
            currentSwipeId={rollIndex}
            totalSwipes={rollCount}
            onSwipeNav={handleSwipeNav}
            onCommitRoll={commitRollResult}
            onSendUserInput={handleSendUserInput}
            isGenerating={isGenerating}
            skitLines={parsedScript.skitLines}
            jumpToIndex={jumpToIndex}
            messageId={loadedMessageId}
            onJumpConsumed={() => setJumpToIndex(null)}
            onDescChange={setCharacterDescription}
            onBgWorldStateChange={setBgWorldState}
            onStatChange={setDisplayOverrides}
            onCollectionChange={handleCollectionChange}
            showBranchConfirm={showBranchConfirm}
          />
        </GameErrorBoundary>
      </div>

      {/* Modals / Overlays */}
      {(currentView === 'STATUS' || currentView === 'RELATIONSHIP') && (
        // 软下线界面：直接退回 GAME，避免误触或旧状态驻留
        <div className="hidden" onLoad={() => switchView('GAME')} />
      )}

      {currentView === 'LOG' && !isTransitioning && (
        <LogScreen
          segments={parsedScript.segments}
          onClose={() => switchView('GAME')}
          playSfx={playSfx}
          onJumpToSegment={index => {
            switchView('GAME');
            setJumpToIndex(index);
          }}
        />
      )}

      {currentView === 'SETTINGS' && !isTransitioning && (
        <SettingsScreen
          settings={settings}
          onUpdateSetting={handleUpdateSetting}
          onClose={() => switchView('GAME')}
          playSfx={playSfx}
        />
      )}

      {currentView === 'SAVE_LOAD' && !isTransitioning && (
        <SaveLoadScreen
          onClose={() => switchView('GAME')}
          onLoadMessage={handleLoadMessage}
          onDeleteFromMessage={handleDeleteFromMessage}
          currentMessageId={loadedMessageId}
          playSfx={playSfx}
        />
      )}

      {currentView === 'COLLECTION' && !isTransitioning && (
        <CollectionScreen onClose={() => switchView('GAME')} playSfx={playSfx} />
      )}

      {currentView === 'CG_CONFIG' && !isTransitioning && (
        <CGConfigScreen onClose={() => switchView('GAME')} playSfx={playSfx} />
      )}

      {/* 语音配置弹窗 */}
      <VoiceConfigModal
        isOpen={showVoiceConfig}
        onClose={() => setShowVoiceConfig(false)}
        currentConfig={resourceConfig.voices}
        onSave={handleSaveVoiceConfig}
        playSfx={playSfx}
      />

      {/* 预加载界�?*/}
      {showLoadingScreen && <LoadingScreen progress={preloadProgress} onClose={() => setShowLoadingScreen(false)} />}

      {/* 分支截断确认弹窗 */}
      {showBranchConfirm && (
        <div className="absolute inset-0 z-[200] cozy-overlay flex items-center justify-center animate-in fade-in duration-200">
          <div className="cozy-surface p-8 max-w-sm w-full mx-4 rounded-[24px] shadow-[0_20px_40px_rgba(109,88,76,0.15)] relative overflow-hidden border-[color:rgba(188,74,60,0.3)]">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[rgba(188,74,60,0)] via-[rgba(188,74,60,0.8)] to-[rgba(188,74,60,0)]" />

            <div className="flex items-center gap-3 mb-4 text-[#a44840]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#a44840] animate-pulse" />
              <h3 className="font-mono-retro text-sm tracking-[0.2em] font-bold">BRANCH_CONFIRM</h3>
            </div>

            <p className="font-serif-sc text-[var(--color-cozy-ink)] text-[15px] leading-relaxed mb-8">
              从此处开始新分支？后续为楼层记录将被清除了?{' '}
            </p>

            <div className="flex gap-4 justify-end">
              <button
                onClick={() => {
                  playSfx();
                  setShowBranchConfirm(false);
                  pendingInputRef.current = null;
                }}
                className="px-6 py-2 rounded-[12px] cozy-button-icon text-xs tracking-widest font-mono-retro"
              >
                CANCEL
              </button>
              <button
                onClick={async () => {
                  playSfx();
                  setShowBranchConfirm(false);
                  const text = pendingInputRef.current;
                  pendingInputRef.current = null;
                  if (text && loadedMessageId !== null && latestAssistantMsgId !== null) {
                    // 删除后续为楼层（静默，不触�?DOM 刷新�?                    const lastId = getLastMessageId();
                    const idsToDelete = _.range(loadedMessageId + 1, lastId + 1);
                    if (idsToDelete.length > 0) {
                      await deleteChatMessages(idsToDelete, { refresh: 'none' });
                    }
                    // �?generate 接管发�?生成流程
                    await sendAndGenerate(text);
                  }
                }}
                className="px-6 py-2 rounded-[12px] cozy-button-danger text-xs tracking-widest font-mono-retro relative overflow-hidden group font-bold"
              >
                <div className="absolute inset-0 bg-white/20 -translate-x-full group-hover:animate-[scan_1s_ease-out_infinite]" />
                <span className="relative z-10">CONFIRM</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
