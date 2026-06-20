import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BgFullState, PreparedRichText } from '../parser';
import {
  prepareRichText,
  renderRichText,
  resolveBackgroundImage,
  resolveBgmUrl,
  resolveCgImage,
  resolveCharacterImage,
  slicePreparedRichText,
} from '../parser';
import { preloadNearbySegments } from '../resourceLoader';
import {
  findCGRangeForParagraph,
  getCGForRange,
  onCGProgress,
  triggerCGGenerationWithRange,
} from '../services/cgTaskManager';
import {
  cancelPreloadVoice,
  cancelTempVoice,
  manualPlayVoice,
  regenerateVoice,
  saveTempVoice,
  stopCurrentVoice,
  synthesizeAndPlayVoice,
} from '../services/voiceService';
import {
  BgWorldState,
  CGTaskProgress,
  CollectionEntry,
  DialogueOption,
  DialogueSegment,
  GameSettings,
  ResourceConfig,
  SkitLine,
  StatOverride,
  ThreatLevel,
} from '../types';
import { CGProgressBar } from './CGProgressBar';
import { CGViewer } from './CGViewer';
import { EmotionTagEditorModal } from './EmotionTagEditorModal';
import { PenLine } from './Icons';
import { SkitPlayer } from './SkitPlayer';
import { StatToastOverlay } from './StatToastOverlay';
import { TopControlBar } from './TopControlBar';

const THREAT_TOAST_STYLES: Record<ThreatLevel, { color: string; dot: string; glow: string }> = {
  安全: { color: 'text-[#6f9272]', dot: 'bg-[#8eb190]', glow: 'shadow-[0_0_10px_rgba(142,177,144,0.38)]' },
  低: { color: 'text-[var(--color-cozy-muted)]', dot: 'bg-[var(--color-cozy-accent-soft)]', glow: '' },
  中: { color: 'text-[#b98b5f]', dot: 'bg-[#e5bb8f]', glow: 'shadow-[0_0_10px_rgba(229,187,143,0.34)]' },
  高: { color: 'text-[#ba7f6a]', dot: 'bg-[#dca08c]', glow: 'shadow-[0_0_12px_rgba(220,160,140,0.32)]' },
  极危: { color: 'text-[#b86f6f]', dot: 'bg-[#d89393]', glow: 'shadow-[0_0_12px_rgba(216,147,147,0.36)]' },
};

interface GameInterfaceProps {
  settings: GameSettings;
  onToggleSetting: (setting: keyof GameSettings) => void;
  onShowLog: () => void;
  onShowStatus: () => void;
  onShowSettings: () => void;
  onShowCGConfig: () => void;
  onShowVoiceConfig: () => void;
  onShowSaveLoad: () => void;
  onShowCollection: () => void;
  onShowRelationship: () => void;
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
  playSfx: () => void;
  onBgmChange: (url: string) => void;
  /** 从历史楼层继承的 BGM URL（由 App 层回溯得到，mount 时播放） */
  inheritedBgmUrl: string;
  /** 从历史楼层继承的背景信息（由 App 层回溯得到，作为 computeAccumulatedState 初始值） */
  inheritedBg: BgFullState | null;
  /** 已解析的对话段落 */
  segments: DialogueSegment[];
  /** 资源映射配置（从世界书异步加载） */
  resourceConfig: ResourceConfig;
  /** Roll 回调 */
  onRoll: () => void;
  isRolling: boolean;
  currentSwipeId: number;
  totalSwipes: number;
  onSwipeNav: (direction: 'prev' | 'next') => void;
  /** 确认选定当前 Roll 结果并写回酒馆楼层 */
  onCommitRoll: () => Promise<void>;
  /** 发送用户输入（带分支截断确认） */
  onSendUserInput: (text: string) => Promise<void>;
  /** 是否正在生成 AI 回复 */
  isGenerating: boolean;
  /** 小剧场数据（上一楼解析得到，生成期间播放） */
  skitLines: SkitLine[];
  /** Log 跳转目标段落索引（null 表示无跳转请求） */
  jumpToIndex: number | null;
  /** 跳转消费完成后的回调，用于清除跳转信号 */
  onJumpConsumed: () => void;
  /** 描述变更回调（推进到含 [desc:] 的段落时触发） */
  onDescChange: (desc: string) => void;
  /** bg 世界状态变更回调（推进到含 [bg:] 的段落时触发） */
  onBgWorldStateChange: (state: BgWorldState) => void;
  /** 段落级状态覆写变更回调（推进到含 [stat:] 的段落时触发） */
  onStatChange: (stats: StatOverride[]) => void;
  /** 收集条目变更回调（推进到含 [收集:] 的段落时触发，用于持久化到角色卡变量） */
  onCollectionChange: (collections: CollectionEntry[]) => void;
  /** 是否显示分支截断确认弹窗（由 App 层控制） */
  showBranchConfirm: boolean;
  /** 当前楼层 ID（用于 CG 生成和缓存） */
  messageId: number | null;
}

/**
 * 扫描 0..index 的所有段落，累积计算当前应有的效果状态
 */
function computeAccumulatedState(
  segments: DialogueSegment[],
  index: number,
  config: ResourceConfig,
  inheritedBg?: BgFullState | null,
): {
  bgUrl: string;
  bgName: string;
  bgThreat: ThreatLevel;
  bgTime: string;
  charName: string;
  /** 立绘显示的角色名（about 优先于 char） */
  spriteCharName: string;
  faceUrl: string;
  faceName: string;
  bgmUrl: string;
  bgmName: string;
  desc: string;
  /** 是否处于 CG 模式 */
  isCgMode: boolean;
  /** CG 图 URL（仅 CG 模式有值） */
  cgUrl: string;
  cgName: string;
  /** 累积的段落级状态覆写（后出现的同 path 覆盖前面的） */
  accumulatedStats: StatOverride[];
  /** 累积的收集条目（按出现顺序，去重） */
  accumulatedCollections: CollectionEntry[];
} {
  // 使用继承的背景作为初始值（如果有的话）
  let bgName = inheritedBg?.场景 || '';
  let bgThreat: ThreatLevel = inheritedBg?.威胁等级 || '低';
  let bgTime = inheritedBg?.时间 || '';
  let bgKey = inheritedBg?.bgKey || '';
  let charName = '';
  let faceName = '';
  let bgmName = '';
  let aboutName = '';
  let desc = '';
  let cgName = '';
  let isCgMode = false;
  // 累积 [stat:] 覆写：
  //   set 模式：后者覆盖前者（状态类赋值）
  //   delta 模式：同 path 的增量累加（数值类增量）
  const statsMap = new Map<string, StatOverride>();
  // 累积 [收集:] 条目（按 type+title 去重）
  const collectionsMap = new Map<string, CollectionEntry>();

  for (let i = 0; i <= index; i++) {
    const eff = segments[i].effects;
    if (eff.bg) {
      bgName = eff.bg;
      if (eff.bgThreat) bgThreat = eff.bgThreat as ThreatLevel;
      if (eff.bgTime) bgTime = eff.bgTime;
      bgKey = eff.bgKey || '';
      // [bg:] 退出 CG 模式
      cgName = '';
      isCgMode = false;
    }
    if (eff.cg) {
      // [cg:] 进入 CG 模式
      cgName = eff.cg;
      isCgMode = true;
    }
    if (eff.char) {
      charName = eff.char;
      aboutName = ''; // char 切换时清除 about
      faceName = ''; // char 切换时清除 face
    }
    if (eff.about) {
      aboutName = eff.about;
      faceName = ''; // about 切换时清除 face，避免残留上一个角色的表情
    }
    if (eff.face) faceName = eff.face;
    if (eff.bgm) bgmName = eff.bgm;
    if (eff.desc) desc = eff.desc;
    if (eff.stats) {
      for (const s of eff.stats) {
        if (s.mode === 'delta') {
          // 增量模式：累加到已有的 delta 上
          const existing = statsMap.get(s.path);
          if (
            existing &&
            existing.mode === 'delta' &&
            typeof existing.value === 'number' &&
            typeof s.value === 'number'
          ) {
            statsMap.set(s.path, { path: s.path, value: existing.value + s.value, mode: 'delta' });
          } else {
            statsMap.set(s.path, s);
          }
        } else {
          // 赋值模式：直接覆盖
          statsMap.set(s.path, s);
        }
      }
    }
    if (eff.collections) {
      for (const c of eff.collections) {
        const key = `${c.type}:${c.title}`;
        if (!collectionsMap.has(key)) {
          collectionsMap.set(key, c);
        }
      }
    }
  }

  // 立绘显示优先使用 about 指定的角色，其次使用 char（说话人）
  const spriteCharName = aboutName || charName;

  return {
    bgUrl: bgName ? resolveBackgroundImage(config, bgName, bgKey) : '',
    bgName,
    bgThreat,
    bgTime,
    charName,
    spriteCharName,
    faceUrl: spriteCharName ? resolveCharacterImage(config, spriteCharName, faceName) : '',
    faceName,
    bgmUrl: bgmName ? resolveBgmUrl(config, bgmName) : '',
    bgmName,
    desc,
    isCgMode,
    cgUrl: isCgMode && cgName ? resolveCgImage(config, cgName) : '',
    cgName,
    accumulatedStats: [...statsMap.values()],
    accumulatedCollections: [...collectionsMap.values()],
  };
}

export const GameInterface: React.FC<GameInterfaceProps> = ({
  settings,
  onToggleSetting,
  onShowLog,
  onShowStatus,
  onShowSettings,
  onShowCGConfig,
  onShowVoiceConfig,
  onShowSaveLoad,
  onShowCollection,
  onShowRelationship,
  onToggleFullscreen,
  isFullscreen,
  playSfx,
  onBgmChange,
  inheritedBgmUrl,
  inheritedBg,
  segments,
  resourceConfig,
  onRoll,
  isRolling,
  currentSwipeId,
  totalSwipes,
  onSwipeNav,
  onCommitRoll,
  onSendUserInput,
  isGenerating,
  skitLines,
  jumpToIndex,
  onJumpConsumed,
  onDescChange,
  onBgWorldStateChange,
  onStatChange,
  onCollectionChange,
  showBranchConfirm,
  messageId,
}) => {
  // 直接使用外部传入的段落
  const parsedSegments = segments;

  // 构造一个 fallback segment，防止空 segments 导致后续访问崩溃
  const FALLBACK_SEGMENT: DialogueSegment = {
    id: 'fallback',
    speaker: '系统',
    text: '',
    effects: {},
    isInnerMonologue: false,
    options: [],
  };

  // 背景/CG 交叠渐变状态：prev 静态垫底，current 用 fade-in 淡入覆盖
  const [bgState, setBgState] = useState<{ current: string | null; prev: string | null }>({
    current: null,
    prev: null,
  });
  const [cgState, setCgState] = useState<{ current: string | null; prev: string | null }>({
    current: null,
    prev: null,
  });
  const [rangeCgState, setRangeCgState] = useState<{ current: string | null; prev: string | null }>({
    current: null,
    prev: null,
  });

  // State for progression
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  // 打字机重置 key：每次需要强制重新触发打字机 effect 时递增
  const [typingResetKey, setTypingResetKey] = useState(0);
  // 安全 clamp：防止 segments 为空或 currentLineIndex 越界导致 undefined
  const safeIndex = parsedSegments.length > 0 ? Math.min(currentLineIndex, parsedSegments.length - 1) : 0;
  const currentSegment: DialogueSegment = parsedSegments[safeIndex] ?? FALLBACK_SEGMENT;

  // 当 segments 变化时（读档跳转、Roll 切换），重置到第一段
  const prevSegmentsRef = useRef(parsedSegments);
  useEffect(() => {
    if (prevSegmentsRef.current !== parsedSegments) {
      prevSegmentsRef.current = parsedSegments;
      setCurrentLineIndex(0);
      setShowingOptions(false);
      setDisplayedText('');
      setTypingResetKey(k => k + 1);
      // 重置 bg 世界状态追踪，确保新 segments 的首段 bg 能触发同步
      prevBgWorldStateRef.current = '';
    }
  }, [parsedSegments]);

  // Log 跳转：当 jumpToIndex 变化时，跳转到目标段落并通知消费完成
  useEffect(() => {
    if (jumpToIndex !== null && jumpToIndex >= 0 && jumpToIndex < parsedSegments.length) {
      // 修复：将跳转视为前进导航，确保 BGM、desc 等资源能正确同步
      isForwardRef.current = true;
      hasUserNavigatedRef.current = true;
      // 重置 BGM 追踪，允许跳转后的 BGM 更新
      prevBgmRef.current = '';

      setCurrentLineIndex(jumpToIndex);
      setShowingOptions(false);
      setDisplayedText('');
      setTypingResetKey(k => k + 1);
      onJumpConsumed();
    }
  }, [jumpToIndex]);

  // 选项页状态：独立页面，不与对话框共存
  const [showingOptions, setShowingOptions] = useState(false);

  // 语音操作按钮组状态
  const [showVoiceActions, setShowVoiceActions] = useState(false);
  const [isRegeneratingVoice, setIsRegeneratingVoice] = useState(false);
  const [isSavingVoice, setIsSavingVoice] = useState(false);
  const [showEmotionEditor, setShowEmotionEditor] = useState(false);

  // 是否已到达最后一段（停留在最后态）
  const isAtEnd = safeIndex >= parsedSegments.length - 1;
  // 当前段落是否有选项
  const hasOptions = currentSegment.options.length > 0;

  // 自行输入状态
  const [isCustomInput, setIsCustomInput] = useState(false);
  const [customText, setCustomText] = useState('');
  const [isSendingCustom, setIsSendingCustom] = useState(false);
  const customInputRef = useRef<HTMLInputElement>(null);

  // Track navigation direction: true = forward/initial, false = backward
  const isForwardRef = useRef(true);

  // ====== CG 动态生成状态 ======
  const [cgProgress, setCgProgress] = useState<CGTaskProgress>({ status: 'idle' });
  const [activeCGRange, setActiveCGRange] = useState<{
    startIndex: number;
    endIndex: number;
    imageUrl: string;
  } | null>(null);
  // CG 全屏查看器状态
  const [showCGViewer, setShowCGViewer] = useState(false);
  // 跟踪当前正在加载的范围，避免重复请求
  const loadingCGRangeRef = useRef<string | null>(null);

  // 监听 CG 生成进度
  useEffect(() => {
    const unsubscribe = onCGProgress(progress => {
      setCgProgress(progress);
    });
    return unsubscribe;
  }, []);

  // 当段落推进时，检查是否在 CG 范围内
  useEffect(() => {
    if (messageId === null || safeIndex < 0) return;

    let cancelled = false;
    const checkRange = async () => {
      const range = findCGRangeForParagraph(messageId, safeIndex);

      // 使用 ref 获取最新的 activeCGRange，避免将其加入依赖导致循环触发
      setActiveCGRange(prev => {
        if (range) {
          // 在范围内，检查是否需要加载新的 CG
          if (!prev || range.startIndex !== prev.startIndex || range.endIndex !== prev.endIndex) {
            // 生成范围标识符，用于去重
            const rangeKey = `${messageId}_${range.startIndex}_${range.endIndex}`;

            // 如果当前范围已经在加载中，不重复请求
            if (loadingCGRangeRef.current === rangeKey) {
              return prev;
            }

            // 标记为加载中
            loadingCGRangeRef.current = rangeKey;

            // 进入新范围，加载 CG
            getCGForRange(messageId, range.startIndex, range.endIndex)
              .then(imageUrl => {
                if (imageUrl && !cancelled) {
                  setActiveCGRange({
                    startIndex: range.startIndex,
                    endIndex: range.endIndex,
                    imageUrl,
                  });
                }
                // 加载完成，清除标记
                if (loadingCGRangeRef.current === rangeKey) {
                  loadingCGRangeRef.current = null;
                }
              })
              .catch(() => {
                // 加载失败也要清除标记
                if (loadingCGRangeRef.current === rangeKey) {
                  loadingCGRangeRef.current = null;
                }
              });
            // 先保持之前的状态，等异步加载完成后再更新
            return prev;
          }
          // 如果已经在同一范围内，不做任何操作（保持显示当前 CG）
          return prev;
        } else if (prev) {
          // 离开范围，清除 CG 和加载标记
          loadingCGRangeRef.current = null;
          return null;
        }
        return prev;
      });
    };

    checkRange();
    return () => {
      cancelled = true;
    };
  }, [messageId, safeIndex]);

  // 触发 CG 生成
  const handleTriggerCG = useCallback(async () => {
    if (!messageId) {
      return;
    }
    if (cgProgress.status === 'analyzing' || cgProgress.status === 'generating') {
      return;
    }
    playSfx();
    const paragraphs = parsedSegments.map(seg => seg.text);
    if (paragraphs.length === 0) {
      return;
    }

    // 使用范围生成
    const ranges = await triggerCGGenerationWithRange(paragraphs, messageId, resourceConfig.characterAppearances, true);

    if (ranges.length > 0) {
      // 检查当前段落是否在某个范围内，如果是则立即加载
      const currentRange = findCGRangeForParagraph(messageId, safeIndex);
      if (currentRange) {
        const imageUrl = await getCGForRange(messageId, currentRange.startIndex, currentRange.endIndex);
        if (imageUrl) {
          setActiveCGRange({
            startIndex: currentRange.startIndex,
            endIndex: currentRange.endIndex,
            imageUrl,
          });
        }
      }
    }
  }, [messageId, cgProgress.status, parsedSegments, resourceConfig.characterAppearances, playSfx, safeIndex]);

  // Accumulated state (computed from history scan)
  const accState = useMemo(
    () => computeAccumulatedState(parsedSegments, safeIndex, resourceConfig, inheritedBg),
    [parsedSegments, safeIndex, resourceConfig, inheritedBg],
  );

  // Scene toast state
  const [showSceneToast, setShowSceneToast] = useState(false);
  const sceneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Character Sprite Management (cross-fade)
  // 新增 charName 字段用于判断是否同角色切换
  const [activeSprites, setActiveSprites] = useState<
    Array<{ id: string; url: string; charName: string; opacity: 'opacity-0' | 'opacity-100' }>
  >([]);
  // 追踪上一次的立绘角色名，用于判断是否同角色换表情还是换角色
  const prevSpriteCharRef = useRef('');
  // 追踪上一次的立绘URL，用于判断是否从无立绘状态切换到有立绘
  const prevSpriteUrlRef = useRef('');
  // 动态过渡时长：从无到有带缩放 700ms，立绘间切换 300ms
  const [spriteDuration, setSpriteDuration] = useState(700);

  // Typing effect state
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  // Speed: 40ms base, 10ms for 3x (approx)
  const typingSpeed = settings.speed === 2 ? 10 : 40;
  const typingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 预解析缓存 ref：段落切换时一次性解析，打字机 tick 时直接使用
  const preparedTextRef = useRef<PreparedRichText | null>(null);
  // requestAnimationFrame ID ref
  const rafIdRef = useRef<number | null>(null);

  // Track previous bgm to avoid redundant changes
  const prevBgmRef = useRef('');
  // Track previous desc to avoid redundant changes and initial trigger
  const prevDescRef = useRef('');
  // Track previous bg world state to avoid redundant changes
  const prevBgWorldStateRef = useRef('');
  // Track whether user has actively navigated (to skip initial render desc trigger)
  const hasUserNavigatedRef = useRef(false);

  // On mount: play inherited BGM from previous floors (resolved by App layer)
  // Only plays if there's a valid inherited URL — does NOT scan current floor's segments
  useEffect(() => {
    if (inheritedBgmUrl) {
      prevBgmRef.current = inheritedBgmUrl;
      onBgmChange(inheritedBgmUrl);
    }
  }, [inheritedBgmUrl]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (sceneTimerRef.current) clearTimeout(sceneTimerRef.current);
      if (typingTimerRef.current) clearInterval(typingTimerRef.current);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  // ========== State Synchronization ==========
  useEffect(() => {
    // 1. BGM change — only trigger when navigating forward (not on backward/prev)
    if (isForwardRef.current && accState.bgmUrl && accState.bgmUrl !== prevBgmRef.current) {
      prevBgmRef.current = accState.bgmUrl;
      onBgmChange(accState.bgmUrl);
    }

    // 1.5. Desc change — 跳转或前进时，如果累积描述发生变化则更新（使用 accState.desc 而非 currentSegment.effects.desc）
    if (hasUserNavigatedRef.current && accState.desc && accState.desc !== prevDescRef.current) {
      prevDescRef.current = accState.desc;
      onDescChange(accState.desc);
    }

    // 1.6. Bg world state change — always sync to Status panel whenever accumulated state changes
    {
      const stateKey = `${accState.bgName}|${accState.bgThreat}|${accState.bgTime}`;
      if (stateKey !== prevBgWorldStateRef.current) {
        prevBgWorldStateRef.current = stateKey;
        onBgWorldStateChange({
          场景: accState.bgName,
          威胁等级: accState.bgThreat,
          时间: accState.bgTime,
        });
      }
    }

    // 1.7. Stat overlay change — trigger when accumulated stats change
    if (hasUserNavigatedRef.current && accState.accumulatedStats.length > 0) {
      onStatChange(accState.accumulatedStats);
    } else if (hasUserNavigatedRef.current && accState.accumulatedStats.length === 0) {
      onStatChange([]);
    }

    // 1.8. Collection change — persist new collection entries to character variable
    if (hasUserNavigatedRef.current && isForwardRef.current && accState.accumulatedCollections.length > 0) {
      onCollectionChange(accState.accumulatedCollections);
    }

    // 2. Scene toast: show when bg changes on current segment (not in CG mode)
    // 只在前进时触发，后退时不触发（避免回顾剧情时重复弹出）
    if (isForwardRef.current && currentSegment.effects.bg && !accState.isCgMode) {
      setShowSceneToast(true);
      if (sceneTimerRef.current) clearTimeout(sceneTimerRef.current);
      sceneTimerRef.current = setTimeout(() => {
        setShowSceneToast(false);
      }, 2500);
    }

    // 3. Character sprite transition
    const targetFaceUrl = accState.faceUrl;
    const targetCharName = accState.spriteCharName;
    const prevCharName = prevSpriteCharRef.current;
    const prevUrl = prevSpriteUrlRef.current;

    // 判断是否从无立绘到有立绘（需要缩放动画）
    const isFromEmpty = !prevUrl && targetFaceUrl;
    // 立绘间切换：300ms 渐变，无缩放
    // 从无到有：700ms 渐变+缩放
    const duration = isFromEmpty ? 700 : 300;
    setSpriteDuration(duration);
    prevSpriteCharRef.current = targetCharName;
    prevSpriteUrlRef.current = targetFaceUrl;

    // 立绘切换：立即添加到 DOM，让浏览器自行处理加载和渲染
    let animRaf: number | undefined;
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;

    if (!targetFaceUrl) {
      // 无立绘目标，淡出所有
      setActiveSprites(prev => prev.map(s => ({ ...s, opacity: 'opacity-0' as const })));
      cleanupTimer = setTimeout(() => {
        setActiveSprites([]);
      }, duration + 100);
    } else {
      // 立即添加到 DOM（不等待加载）
      setActiveSprites(prev => {
        const next = [...prev];
        const now = Date.now();
        const existing = next.find(s => s.url === targetFaceUrl);
        if (!existing) {
          next.push({
            id: `${targetFaceUrl}-${now}`,
            url: targetFaceUrl,
            charName: targetCharName,
            opacity: 'opacity-0',
          });
        }
        return next;
      });

      // 双重 RAF 确保 DOM 已渲染，然后触发渐变
      animRaf = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setActiveSprites(prev =>
            prev.map(s => {
              if (s.url === targetFaceUrl) {
                return { ...s, opacity: 'opacity-100' };
              } else {
                return { ...s, opacity: 'opacity-0' };
              }
            }),
          );
        });
      });

      // 清理不可见的立绘
      cleanupTimer = setTimeout(() => {
        setActiveSprites(prev => prev.filter(s => s.opacity === 'opacity-100' || s.url === targetFaceUrl));
      }, duration + 100);
    }

    // 4. 预加载后续段落的资源
    preloadNearbySegments(parsedSegments, safeIndex, resourceConfig);

    return () => {
      if (animRaf !== undefined) cancelAnimationFrame(animRaf);
      if (cleanupTimer) clearTimeout(cleanupTimer);
    };
  }, [currentLineIndex, parsedSegments]);

  // ====== 背景 / CG / 范围 CG 交叠渐变（独立 useEffect，避免 stale closure 错位）======
  // 渐变时长（与 CSS animation 时长保持一致）
  const FADE_DURATION_MS = 800;

  // 背景：直接响应 accState 变化，立即更新
  useEffect(() => {
    const targetBgUrl = !accState.isCgMode && accState.bgUrl ? accState.bgUrl : null;

    if (!targetBgUrl) {
      setBgState(s => ({ current: null, prev: s.current }));
      const t = setTimeout(() => setBgState({ current: null, prev: null }), FADE_DURATION_MS);
      return () => clearTimeout(t);
    }

    // 立即更新背景状态
    setBgState(s => {
      if (s.current === targetBgUrl) return s;
      return { current: targetBgUrl, prev: s.current };
    });

    const cleanupTimer = setTimeout(
      () => setBgState(s => (s.current === targetBgUrl ? { ...s, prev: null } : s)),
      FADE_DURATION_MS,
    );

    return () => {
      clearTimeout(cleanupTimer);
    };
  }, [accState.isCgMode, accState.bgUrl]);

  // CG：直接响应 accState 变化，立即更新
  useEffect(() => {
    const targetCgUrl = accState.isCgMode && accState.cgUrl ? accState.cgUrl : null;

    if (!targetCgUrl) {
      // 退出CG模式时，立即清空所有CG状态（不保留prev），让背景立即显示
      setCgState({ current: null, prev: null });
      return;
    }

    setCgState(s => {
      if (s.current === targetCgUrl) return s;
      return { current: targetCgUrl, prev: s.current };
    });

    const cleanupTimer = setTimeout(
      () => setCgState(s => (s.current === targetCgUrl ? { ...s, prev: null } : s)),
      FADE_DURATION_MS,
    );

    return () => {
      clearTimeout(cleanupTimer);
    };
  }, [accState.isCgMode, accState.cgUrl]);

  // 范围 CG：直接响应 activeCGRange 变化，立即更新
  useEffect(() => {
    const targetRangeCgUrl = activeCGRange?.imageUrl ?? null;

    if (!targetRangeCgUrl) {
      // 退出范围CG时，立即清空所有状态
      setRangeCgState({ current: null, prev: null });
      return;
    }

    setRangeCgState(s => {
      if (s.current === targetRangeCgUrl) return s;
      return { current: targetRangeCgUrl, prev: s.current };
    });

    const cleanupTimer = setTimeout(
      () => setRangeCgState(s => (s.current === targetRangeCgUrl ? { ...s, prev: null } : s)),
      FADE_DURATION_MS,
    );

    return () => {
      clearTimeout(cleanupTimer);
    };
  }, [activeCGRange?.imageUrl]);

  // Auto-play effect — 有选项或已到末尾或正在显示选项时不自动前进
  useEffect(() => {
    let autoTimer: ReturnType<typeof setTimeout>;
    if (settings.autoPlay && !isTyping && !hasOptions && !isAtEnd && !showingOptions) {
      autoTimer = setTimeout(() => {
        handleNext();
      }, 2000);
    }
    return () => clearTimeout(autoTimer);
  }, [settings.autoPlay, isTyping, currentLineIndex, hasOptions, isAtEnd, showingOptions]);

  // Typing logic — 使用 requestAnimationFrame + 预解析缓存，避免每帧重新 tokenize
  // 同时触发语音播报（边打字边播放）
  useEffect(() => {
    // 双语支持：优先使用 textJa，如果没有则回退到 text
    const fullText = currentSegment.textJa || currentSegment.text;
    // TTS 文本：只使用日语部分
    const ttsText = currentSegment.textJa || currentSegment.text;

    setDisplayedText('');
    setIsTyping(true);

    if (!fullText) {
      setIsTyping(false);
      return;
    }

    // ====== 清空预加载队列，优先处理实时播放 ======
    cancelPreloadVoice();

    // ====== 语音播报：打字开始时立即触发合成和播放 ======
    const voiceConfig = resourceConfig.voices;
    const speaker = currentSegment.speaker;

    if (voiceConfig?.enabled && voiceConfig.autoPlay && speaker !== '旁白' && voiceConfig.characterVoices[speaker]) {
      const voiceSettings = voiceConfig.characterVoices[speaker];
      // 异步调用，不阻塞打字机，使用 ttsText（仅日语）
      synthesizeAndPlayVoice(ttsText, voiceSettings, voiceConfig, settings.volumeVoice).catch(err => {
        console.error(`[GameInterface] 角色 ${speaker} 语音播放失败:`, err);
      });
    }
    // ====== 语音播报结束 ======

    // 一次性预解析，后续 tick 只做 slice
    const prepared = prepareRichText(fullText);
    preparedTextRef.current = prepared;
    const totalVisible = prepared.totalVisible;
    let visibleIndex = 0;
    let lastTime = performance.now();

    // 立即显示第一个字符
    visibleIndex++;
    setDisplayedText(slicePreparedRichText(prepared, visibleIndex));

    if (visibleIndex >= totalVisible) {
      setIsTyping(false);
      // 打字完成时，触发 stat 更新（流式输出需要）
      if (accState.accumulatedStats.length > 0) {
        onStatChange(accState.accumulatedStats);
      }
      return;
    }

    const frame = (now: number) => {
      const elapsed = now - lastTime;
      if (elapsed >= typingSpeed) {
        // 根据实际经过时间计算应推进的字符数（补偿掉帧）
        const steps = Math.max(1, Math.floor(elapsed / typingSpeed));
        visibleIndex = Math.min(visibleIndex + steps, totalVisible);
        lastTime = now - (elapsed % typingSpeed);
        setDisplayedText(slicePreparedRichText(prepared, visibleIndex));

        if (visibleIndex >= totalVisible) {
          setIsTyping(false);
          rafIdRef.current = null;
          // 打字完成时，触发 stat 更新（流式输出需要）
          if (accState.accumulatedStats.length > 0) {
            onStatChange(accState.accumulatedStats);
          }
          return;
        }
      }
      rafIdRef.current = requestAnimationFrame(frame);
    };

    rafIdRef.current = requestAnimationFrame(frame);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [
    currentLineIndex,
    settings.speed,
    currentSegment.text,
    currentSegment.textJa,
    currentSegment.textZh,
    typingResetKey,
    resourceConfig.voices,
  ]);

  const handleNext = () => {
    if (showingOptions) return; // 选项页显示时不允许前进
    // 已到达最后一段且无选项，完全停留，不做任何操作
    if (isAtEnd && !hasOptions) return;
    // 如果当前段有选项且打字已完成，进入选项页
    if (hasOptions && !isTyping) {
      setShowingOptions(true);
      setIsCustomInput(false);
      setCustomText('');
      return;
    }
    isForwardRef.current = true;
    hasUserNavigatedRef.current = true;
    setDisplayedText('');
    if (currentLineIndex < parsedSegments.length - 1) {
      setCurrentLineIndex(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    // 如果在选项页，先退回到对话
    if (showingOptions) {
      setShowingOptions(false);
      setIsCustomInput(false);
      setCustomText('');
      playSfx();
      return;
    }
    if (currentLineIndex <= 0) return;
    isForwardRef.current = false;
    playSfx();
    setDisplayedText('');
    setCurrentLineIndex(prev => prev - 1);
  };

  // 发送用户输入：委托给 App 层处理（含分支截断确认）
  const sendUserInput = useCallback(
    async (text: string) => {
      await onSendUserInput(text);
    },
    [onSendUserInput],
  );

  // 选项点击：将选项文本作为用户输入发送给酒馆
  const handleOptionClick = useCallback(
    async (option: DialogueOption) => {
      playSfx();
      try {
        await sendUserInput(option.text);
      } catch (e) {
        console.error('[wasteland-echoes-ui] 发送选项失败:', e);
      }
    },
    [playSfx, sendUserInput],
  );

  // 自行输入发送
  const handleCustomInputSend = useCallback(async () => {
    const text = customText.trim();
    if (!text || isSendingCustom) return;
    playSfx();
    setIsSendingCustom(true);
    try {
      await sendUserInput(text);
    } catch (e) {
      console.error('[wasteland-echoes-ui] 发送自定义输入失败:', e);
    } finally {
      setIsSendingCustom(false);
      setCustomText('');
      setIsCustomInput(false);
    }
  }, [customText, isSendingCustom, playSfx, sendUserInput]);

  const handleTextBoxClick = () => {
    if (isTyping) {
      // 跳过打字机：取消 raf，直接显示完整文本，同时停止语音
      stopCurrentVoice(); // 停止当前播放的语音
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (typingTimerRef.current) clearInterval(typingTimerRef.current);
      const prepared = preparedTextRef.current;
      // 双语支持：优先使用 textJa，回退到 text
      const fullText = currentSegment.textJa || currentSegment.text;
      setDisplayedText(prepared ? prepared.fullHtml : renderRichText(fullText));
      setIsTyping(false);
    } else {
      handleNext();
    }
  };

  // ====== 语音操作功能 ======

  // 检查当前角色是否有语音配置
  const hasVoiceConfig = useCallback(() => {
    const voiceConfig = resourceConfig.voices;
    const speaker = currentSegment.speaker;
    return voiceConfig?.enabled && speaker !== '旁白' && !!voiceConfig.characterVoices[speaker];
  }, [resourceConfig.voices, currentSegment.speaker]);

  // 手动播放当前语音
  const handlePlayVoice = useCallback(async () => {
    const voiceConfig = resourceConfig.voices;
    const speaker = currentSegment.speaker;
    if (!voiceConfig || !voiceConfig.characterVoices[speaker]) return;

    const ttsText = currentSegment.textJa || currentSegment.text;
    const voiceSettings = voiceConfig.characterVoices[speaker];

    playSfx();
    try {
      await manualPlayVoice(ttsText, voiceSettings, voiceConfig, settings.volumeVoice);
    } catch (err) {
      console.error('[GameInterface] 手动播放语音失败:', err);
    }
  }, [resourceConfig.voices, currentSegment, settings.volumeVoice, playSfx]);

  // 重新生成语音
  const handleRegenerateVoice = useCallback(async () => {
    const voiceConfig = resourceConfig.voices;
    const speaker = currentSegment.speaker;
    if (!voiceConfig || !voiceConfig.characterVoices[speaker]) return;

    const ttsText = currentSegment.textJa || currentSegment.text;
    const voiceSettings = voiceConfig.characterVoices[speaker];

    playSfx();
    setIsRegeneratingVoice(true);
    try {
      await regenerateVoice(ttsText, voiceSettings, voiceConfig);
    } catch (err) {
      console.error('[GameInterface] 重新生成语音失败:', err);
      alert('重新生成失败，请检查网络或 API 配置');
    } finally {
      setIsRegeneratingVoice(false);
    }
  }, [resourceConfig.voices, currentSegment, playSfx]);

  // 保存当前语音
  const handleSaveVoice = useCallback(async () => {
    const voiceConfig = resourceConfig.voices;
    const speaker = currentSegment.speaker;
    if (!voiceConfig || !voiceConfig.characterVoices[speaker]) return;

    const ttsText = currentSegment.textJa || currentSegment.text;
    const voiceSettings = voiceConfig.characterVoices[speaker];

    playSfx();
    setIsSavingVoice(true);
    try {
      await saveTempVoice(ttsText, voiceSettings.voice);
      setShowVoiceActions(false); // 保存后关闭按钮组
    } catch (err) {
      console.error('[GameInterface] 保存语音失败:', err);
    } finally {
      setIsSavingVoice(false);
    }
  }, [resourceConfig.voices, currentSegment, playSfx]);

  // 取消语音操作
  const handleCancelVoice = useCallback(async () => {
    const voiceConfig = resourceConfig.voices;
    const speaker = currentSegment.speaker;
    if (!voiceConfig || !voiceConfig.characterVoices[speaker]) return;

    const ttsText = currentSegment.textJa || currentSegment.text;
    const voiceSettings = voiceConfig.characterVoices[speaker];

    playSfx();
    try {
      await cancelTempVoice(ttsText, voiceSettings.voice);
      setShowVoiceActions(false);
    } catch (err) {
      console.error('[GameInterface] 取消语音失败:', err);
    }
  }, [resourceConfig.voices, currentSegment, playSfx]);

  // 段落切换时关闭语音操作按钮组
  useEffect(() => {
    setShowVoiceActions(false);
  }, [currentLineIndex]);

  // Keyboard Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+F11 全屏快捷键
      if (e.ctrlKey && e.key === 'F11') {
        e.preventDefault();
        onToggleFullscreen();
        return;
      }

      if (e.ctrlKey || e.altKey || e.metaKey) return;

      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case ' ':
        case 'Enter':
          e.preventDefault();
          handleTextBoxClick();
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          handlePrev();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleTextBoxClick, handlePrev, onToggleFullscreen]);

  return (
    <div className="font-editor-sans relative flex h-full w-full flex-col overflow-hidden bg-[var(--color-cozy-bg)] text-[var(--color-cozy-ink)] transition-colors duration-1000">
      {/* Dynamic Background / CG Layer - 双层 prev/current 交叠淡入 */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        {/* 背景层（z-0） - prev 静态垫底，current 用 fade-in 淡入 */}
        {bgState.prev && (
          <div
            key={`bg-prev-${bgState.prev}`}
            className="absolute inset-0 bg-cover bg-center bg-no-repeat z-0"
            style={{ backgroundImage: `url(${bgState.prev})`, transform: 'scale(1.02)' }}
          />
        )}
        {bgState.current && (
          <div
            key={`bg-cur-${bgState.current}`}
            className="absolute inset-0 bg-cover bg-center bg-no-repeat z-0 cg-fade-in"
            style={{ backgroundImage: `url(${bgState.current})`, transform: 'scale(1.02)' }}
          />
        )}

        {/* 深色垫底层（z-[4]）- 防止 CG 切换时露出白色底色，作为预加载失败的保险措施 */}
        {(cgState.current || cgState.prev || rangeCgState.current || rangeCgState.prev) && (
          <div className="absolute inset-0 bg-gradient-to-b from-stone-900/95 to-stone-950/98 z-[4]" />
        )}

        {/* CG 层（z-[5]） - prev 静态垫底，current 用 fade-in 淡入 */}
        {cgState.prev && (
          <div
            key={`cg-prev-${cgState.prev}`}
            className="absolute inset-0 bg-cover bg-center bg-no-repeat z-[5]"
            style={{ backgroundImage: `url(${cgState.prev})`, transform: 'scale(1.02)' }}
          />
        )}
        {cgState.current && (
          <div
            key={`cg-cur-${cgState.current}`}
            className="absolute inset-0 bg-cover bg-center bg-no-repeat z-[5] cg-fade-in"
            style={{ backgroundImage: `url(${cgState.current})`, transform: 'scale(1.02)' }}
          />
        )}

        {/* 范围 CG 层（z-[6]） - prev 静态垫底，current 用 fade-in 淡入 */}
        {rangeCgState.prev && (
          <div
            key={`range-cg-prev-${rangeCgState.prev}`}
            className="absolute inset-0 bg-cover bg-center bg-no-repeat z-[6] cursor-pointer"
            style={{ backgroundImage: `url(${rangeCgState.prev})`, imageRendering: '-webkit-optimize-contrast' }}
          />
        )}
        {rangeCgState.current && (
          <div
            key={`range-cg-cur-${rangeCgState.current}`}
            className="absolute inset-0 bg-cover bg-center bg-no-repeat z-[6] cursor-pointer cg-fade-in"
            style={{ backgroundImage: `url(${rangeCgState.current})`, imageRendering: '-webkit-optimize-contrast' }}
            onClick={() => setShowCGViewer(true)}
            title="点击全屏查看 CG"
          />
        )}

        {/* Fallback 渐变背景（仅在没有任何图片层时显示） */}
        {!bgState.current &&
          !bgState.prev &&
          !cgState.current &&
          !cgState.prev &&
          !rangeCgState.current &&
          !rangeCgState.prev && (
            <>
              <div className="absolute inset-0 bg-[linear-gradient(180deg,#f8f3ee_0%,#efe5da_55%,#e6d9cd_100%)] z-0" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(221,184,176,0.28),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(188,199,186,0.24),transparent_30%),radial-gradient(circle_at_center,rgba(255,255,255,0.3),transparent_48%)]" />
              <div className="absolute inset-0 opacity-[0.18] bg-noise" />
            </>
          )}

        {/* Vignette 装饰（有图片层时叠加） */}
        {(bgState.current || cgState.current || rangeCgState.current) && (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.16),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(188,199,186,0.08),transparent_28%)] z-[7] pointer-events-none" />
        )}
      </div>

      <div className="absolute inset-0 pointer-events-none z-[7] overflow-hidden">
        <div
          className="absolute -left-[12%] top-[6%] h-[36%] w-[36%] rounded-full bg-[rgba(221,184,176,0.16)] blur-[110px] animate-pulse"
          style={{ animationDuration: '11s' }}
        />
        <div
          className="absolute right-[-8%] bottom-[10%] h-[28%] w-[28%] rounded-full bg-[rgba(188,199,186,0.16)] blur-[100px] animate-pulse"
          style={{ animationDuration: '14s' }}
        />
      </div>

      <div
        className="absolute inset-0 z-[8] pointer-events-none opacity-[0.05] mix-blend-soft-light"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.62' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Top Right Control Bar */}
      <TopControlBar
        settings={settings}
        onToggleSetting={onToggleSetting}
        onShowLog={onShowLog}
        onShowStatus={onShowStatus}
        onShowSettings={onShowSettings}
        onShowCGConfig={onShowCGConfig}
        onShowVoiceConfig={onShowVoiceConfig}
        onShowSaveLoad={onShowSaveLoad}
        onShowCollection={onShowCollection}
        onShowRelationship={onShowRelationship}
        onToggleFullscreen={onToggleFullscreen}
        isFullscreen={isFullscreen}
        playSfx={playSfx}
        onBack={handlePrev}
        onRoll={onRoll}
        isRolling={isRolling}
        currentSwipeId={currentSwipeId}
        totalSwipes={totalSwipes}
        onSwipeNav={onSwipeNav}
        onCommitRoll={onCommitRoll}
        onTriggerCG={handleTriggerCG}
        cgProgress={cgProgress}
      />

      {/* Scene Record Indicator */}
      <div
        className={`game-scene-toast absolute top-[3%] left-[2%] sm:left-[5%] z-30 pointer-events-none select-none transition-all duration-[1400ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${showSceneToast && accState.bgName && !accState.isCgMode ? 'opacity-100 translate-y-0 blur-none' : 'opacity-0 -translate-y-4 blur-[6px]'}`}
      >
        {accState.bgName && (
          <div className="cozy-surface-soft relative min-w-[180px] max-w-[68vw] overflow-hidden rounded-[24px] px-4 py-3 text-[var(--color-cozy-ink)] sm:max-w-none sm:px-5 sm:py-4">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(221,184,176,0.22),transparent_40%),radial-gradient(circle_at_bottom_left,rgba(188,199,186,0.16),transparent_38%)]" />
            <div className="relative z-10">
              <div className="mb-2 flex items-center gap-2 sm:gap-3">
                <span
                  className={`h-2 w-2 rounded-full ${THREAT_TOAST_STYLES[accState.bgThreat]?.dot || 'bg-[var(--color-cozy-accent)]'} ${THREAT_TOAST_STYLES[accState.bgThreat]?.glow || ''}`}
                />
                <span className="font-mono-retro text-[7px] uppercase tracking-[0.24em] text-[var(--color-cozy-muted)] sm:text-[9px]">
                  scene note
                </span>
                <div className="cozy-hairline h-px flex-1 opacity-70" />
              </div>
              <h1 className="font-serif-sc text-[15px] font-semibold tracking-[0.06em] text-[var(--color-cozy-ink)] sm:text-[28px] md:text-[40px]">
                {accState.bgName}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[8px] text-[var(--color-cozy-muted)] sm:gap-3 sm:text-[11px] md:text-[13px]">
                {accState.bgTime && <span className="tracking-[0.08em]">{accState.bgTime}</span>}
                {accState.bgTime && accState.bgThreat && (
                  <span className="h-1 w-1 rounded-full bg-[rgba(161,132,117,0.35)]" />
                )}
                {accState.bgThreat && (
                  <span
                    className={`tracking-[0.08em] ${THREAT_TOAST_STYLES[accState.bgThreat]?.color || 'text-[var(--color-cozy-muted)]'}`}
                  >
                    {accState.bgThreat}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Stat Toast Overlay — 技能/物品/收集变化通知 */}
      <StatToastOverlay
        accumulatedStats={accState.accumulatedStats}
        accumulatedCollections={accState.accumulatedCollections}
        isForward={isForwardRef.current}
      />

      {/* Character Sprite Layer — CG 模式或有范围 CG 时隐藏立绘 */}
      <div
        className={`absolute inset-0 z-10 pointer-events-none flex items-end justify-center overflow-visible transition-opacity ${accState.isCgMode || rangeCgState.current || rangeCgState.prev ? 'opacity-0 duration-150' : 'opacity-100 duration-500'}`}
      >
        {activeSprites.map(sprite => {
          // 判断是否需要缩放动画（从无到有的情况）
          const needsScaleAnimation = spriteDuration === 700;

          return (
            <div
              key={sprite.id}
              className={`
                              absolute bottom-0 left-1/2 -translate-x-1/2
                              h-full
                              ease-in-out origin-bottom
                              ${sprite.opacity}
                              ${needsScaleAnimation ? (sprite.opacity === 'opacity-100' ? 'translate-y-0 scale-100' : 'translate-y-4 scale-[0.98]') : ''}
                          `}
              style={{
                transition: needsScaleAnimation
                  ? `all ${spriteDuration}ms ease-in-out`
                  : `opacity ${spriteDuration}ms ease-in-out`,
              }}
            >
              <img
                src={sprite.url}
                alt="Character"
                className="h-full w-auto min-h-full object-cover object-bottom"
                style={{
                  imageRendering: 'high-quality',
                  display: 'block',
                }}
              />
              {/* 已取消角色立绘下缘渐变与发光，避免移动端硬边 */}
            </div>
          );
        })}
      </div>

      {/* ========== 选项独立页 ========== */}
      {showingOptions && !isGenerating && !showBranchConfirm && (
        <div className="absolute inset-0 z-[25] flex items-center justify-center bg-[rgba(103,82,70,0.58)] transition-opacity duration-300 md:backdrop-blur-md md:bg-[rgba(103,82,70,0.26)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.3),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(221,184,176,0.18),transparent_30%)] pointer-events-none" />

          <div
            className="relative flex h-full w-full flex-col items-center justify-center"
            onClick={() => {
              setIsCustomInput(false);
              setCustomText('');
              handlePrev();
            }}
          >
            <div
              className="cozy-surface relative z-10 flex w-full max-w-2xl flex-col items-center gap-4 rounded-[32px] px-4 py-6 md:gap-6 md:px-6 md:py-7"
              onClick={e => e.stopPropagation()}
            >
              <div className="mb-1 flex w-full items-center gap-3">
                <span className="font-serif-sc text-[15px] tracking-[0.08em] text-[var(--color-cozy-ink)]">选择</span>
                <div className="cozy-hairline h-px flex-1 opacity-70" />
                <span className="font-mono-retro text-[8px] uppercase tracking-[0.22em] text-[var(--color-cozy-muted)]">
                  options
                </span>
              </div>

              {currentSegment.options.map((option, idx) => (
                <button
                  key={option.id}
                  onClick={() => handleOptionClick(option)}
                  className="group relative flex h-[64px] w-full items-center justify-center overflow-hidden rounded-[22px] border border-[rgba(161,132,117,0.16)] bg-[rgba(255,252,248,0.92)] text-[var(--color-cozy-ink)] shadow-[0_12px_24px_rgba(109,88,76,0.1)] transition-transform duration-300 ease-out hover:-translate-y-1 md:h-[80px] [@media(max-height:550px)_and_(orientation:landscape)]:!h-[44px]"
                  style={{
                    animationDelay: `${idx * 100}ms`,
                    animation: 'optionSlideIn 0.6s cubic-bezier(0.16,1,0.3,1) forwards',
                    opacity: 0,
                    transform: 'translateY(20px)',
                  }}
                >
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.72),transparent_72%)] opacity-90 hidden md:block" />
                  <div className="absolute inset-x-5 top-0 h-px cozy-hairline opacity-80 hidden md:block" />
                  <span className="relative z-10 font-serif-sc text-lg tracking-[0.12em] text-[var(--color-cozy-ink)] transition-all duration-500 group-hover:tracking-[0.16em] md:text-xl [@media(max-height:550px)_and_(orientation:landscape)]:!text-[13px]">
                    {option.text}
                  </span>
                </button>
              ))}

              {!isCustomInput ? (
                <button
                  onClick={() => {
                    playSfx();
                    setIsCustomInput(true);
                    setTimeout(() => customInputRef.current?.focus(), 50);
                  }}
                  className="group relative flex h-[64px] w-full items-center justify-center rounded-[22px] border border-dashed border-[rgba(161,132,117,0.24)] bg-[rgba(255,250,246,0.42)] text-[var(--color-cozy-muted)] transition-transform duration-300 ease-out hover:-translate-y-1 md:h-[80px] [@media(max-height:550px)_and_(orientation:landscape)]:!h-[44px]"
                  style={{
                    animationDelay: `${currentSegment.options.length * 100}ms`,
                    animation: 'optionSlideIn 0.6s cubic-bezier(0.16,1,0.3,1) forwards',
                    opacity: 0,
                    transform: 'translateY(20px)',
                  }}
                >
                  <span className="relative z-10 flex items-center gap-3 font-serif-sc text-sm tracking-[0.12em] transition-all duration-500 group-hover:tracking-[0.16em] md:text-base [@media(max-height:550px)_and_(orientation:landscape)]:!text-[12px]">
                    <PenLine size={16} className="opacity-60 group-hover:opacity-100 transition-opacity" />
                    自行输入
                  </span>
                </button>
              ) : (
                <div
                  className="cozy-surface-soft relative flex h-[64px] w-full flex-row items-stretch overflow-hidden rounded-[22px] border-[rgba(161,132,117,0.2)] md:h-[80px] [@media(max-height:550px)_and_(orientation:landscape)]:!h-[44px]"
                  style={{
                    animationDelay: `0ms`,
                    animation: 'optionSlideIn 0.4s cubic-bezier(0.16,1,0.3,1) forwards',
                    opacity: 0,
                    transform: 'translateY(10px)',
                  }}
                >
                  <div className="relative flex flex-1 items-center px-6">
                    <div className="absolute inset-y-3 left-0 w-px bg-[rgba(161,132,117,0.22)]" />
                    <input
                      ref={customInputRef}
                      type="text"
                      value={customText}
                      onChange={e => setCustomText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.stopPropagation();
                          handleCustomInputSend();
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          e.stopPropagation();
                          setIsCustomInput(false);
                          setCustomText('');
                        }
                      }}
                      placeholder="写下你的想法……"
                      disabled={isSendingCustom}
                      className="w-full bg-transparent font-serif-sc text-[var(--color-cozy-ink)] outline-none transition-colors placeholder:font-editor-sans placeholder:text-sm placeholder:tracking-[0.08em] placeholder:text-[var(--color-cozy-muted)] disabled:opacity-50 md:text-xl [@media(max-height:550px)_and_(orientation:landscape)]:!text-[13px]"
                    />
                  </div>

                  <button
                    onClick={e => {
                      e.stopPropagation();
                      handleCustomInputSend();
                    }}
                    disabled={isSendingCustom || !customText.trim()}
                    className="relative flex w-[90px] items-center justify-center border-l border-[rgba(161,132,117,0.18)] font-mono-retro text-xs tracking-[0.24em] text-[var(--color-cozy-ink)] transition-colors duration-300 hover:bg-[rgba(255,255,255,0.42)] active:bg-[rgba(255,255,255,0.6)] disabled:opacity-30 disabled:hover:bg-transparent md:w-[120px] md:text-sm"
                  >
                    发送
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========== 生成等待遮罩 ========== */}
      {isGenerating && (
        <div className="absolute inset-0 z-[25] bg-[rgba(95,82,75,0.58)] md:backdrop-blur-sm md:bg-[rgba(95,82,75,0.38)]">
          {skitLines.length > 0 ? (
            <>
              {/* 有小剧场 */}
              <div className="absolute inset-x-0 top-[30%] flex flex-col items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-[var(--color-cozy-accent)] animate-ping" />
                <div className="font-serif-sc text-sm tracking-[0.24em] text-[var(--color-cozy-ink)] animate-pulse">
                  正在继续书写…
                </div>
              </div>
              <div className="absolute inset-x-0 bottom-0 top-[45%] overflow-y-auto flex items-start justify-center px-4 pt-2 pb-6">
                <SkitPlayer lines={skitLines} />
              </div>
            </>
          ) : (
            /* 无小剧场：极致极简居中等待 */
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-[var(--color-cozy-accent)] animate-ping" />
                <div className="font-serif-sc text-sm tracking-[0.24em] text-[var(--color-cozy-ink)] animate-pulse">
                  正在继续书写…
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========== 对话区域（完全贴底，无明确边界边框） ========== */}
      {!showingOptions && !isGenerating && (
        <div
          className="absolute inset-x-0 bottom-0 z-20 w-full cursor-pointer flex flex-col justify-end"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          onClick={handleTextBoxClick}
        >
          {/* 对话区暖色托底 */}
          <div
            className="absolute inset-x-0 bottom-0 top-auto h-[32dvh] portrait:h-[28dvh] landscape:h-[58dvh] lg:h-[52vh] pointer-events-none"
            style={{
              background:
                'linear-gradient(to top, rgba(255,250,246,0.14) 0%, rgba(255,250,246,0.04) 42%, transparent 78%)',
            }}
          />

          {/* 真正的"贴底"排版：恢复原始电脑端的尺寸感，同时解决由于文字换行撑开外层导致的偏移问题 */}
          {/* 外层容器的 max-w-[1000px] 改为 max-w-[100px] 以增加PC端横向长度 */}
          <div className="relative w-full pt-12 landscape:pt-2 pb-0 [@media(max-height:550px)_and_(orientation:landscape)]:!pb-0 px-6 sm:px-10 md:px-[12%] lg:px-[10%] xl:px-[12%] flex flex-col justify-end items-center max-w-[1500px] mx-auto lg:pt-6 landscape:lg:pt-6 mb-[4vh] lg:mb-[6vh] portrait:mb-[4vh] landscape:mb-[2vh]">
            {/* 对话文本外层包裹：使用动态高度类，当姓名框出现时才拉长补偿空间 */}
            {/* max-w-xl 现已放宽为 max-w-2xl md:max-w-3xl lg:max-w-[900px] 以增加PC端对话框横向长度 */}
            {/* 对话框本身不再限制 max-w，由外层容器控制；纵向高度在下面的 h-[xxx] 中调整 */}
            <div
              className={`cozy-surface relative z-10 w-full shrink-0 overflow-hidden rounded-2xl md:rounded-[24px] flex flex-col transition-all duration-300 shadow-[0_24px_48px_rgba(0,0,0,0.12)] ${currentSegment.speaker !== '旁白' ? 'h-[160px] sm:h-[154px] md:h-[178px] lg:h-[216px] xl:h-[234px] landscape:h-[88px] landscape:sm:h-[96px] landscape:md:h-[108px] landscape:lg:h-[180px] [@media(max-height:500px)_and_(orientation:landscape)]:!h-[120px] portrait:h-[180px]' : 'h-[150px] sm:h-[134px] md:h-[158px] lg:h-[196px] xl:h-[214px] landscape:h-[72px] landscape:sm:h-[80px] landscape:md:h-[92px] landscape:lg:h-[164px] [@media(max-height:500px)_and_(orientation:landscape)]:!h-[104px] portrait:h-[160px]'}`}
            >
              {/* 光晕点缀 */}
              <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[rgba(255,255,255,0.8)] to-transparent" />
              <div className="absolute top-0 left-0 w-[1px] h-full bg-gradient-to-b from-[rgba(255,255,255,0.6)] to-transparent" />

              {/* 嵌入式姓名栏：适度的垂直边距，上方留白更舒适 */}
              {currentSegment.speaker !== '旁白' && (
                <div className="relative z-20 flex-shrink-0 flex items-center justify-between px-6 pt-4 pb-1 sm:px-8 sm:pt-5 md:px-10 md:pt-5 lg:pt-6 landscape:pt-2 landscape:pb-0.5">
                  <div className="flex items-center gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-cozy-accent)] animate-breathe" />
                    <h2
                      className={`font-serif-sc text-[16px] md:text-[18px] lg:text-[20px] font-bold tracking-[0.15em] text-[var(--color-cozy-ink)] ${hasVoiceConfig() ? 'cursor-pointer hover:text-[var(--color-cozy-accent)] transition-colors duration-200' : ''}`}
                      onClick={e => {
                        if (hasVoiceConfig()) {
                          e.stopPropagation();
                          playSfx();
                          setShowVoiceActions(!showVoiceActions);
                        }
                      }}
                    >
                      {currentSegment.speaker}
                    </h2>

                    {/* 语音操作按钮组 */}
                    {hasVoiceConfig() && showVoiceActions && (
                      <div
                        className="flex items-center gap-1 animate-in fade-in slide-in-from-left-2 duration-200"
                        onClick={e => e.stopPropagation()}
                      >
                        {/* 播放按钮 */}
                        <button
                          onClick={handlePlayVoice}
                          className="w-5 h-5 flex items-center justify-center text-[var(--color-cozy-muted)] hover:text-[var(--color-cozy-accent)] transition-colors duration-150"
                          title="播放语音"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </button>

                        {/* 重新生成按钮 */}
                        <button
                          onClick={handleRegenerateVoice}
                          disabled={isRegeneratingVoice}
                          className="w-5 h-5 flex items-center justify-center text-[var(--color-cozy-muted)] hover:text-[#b98b5f] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="重新生成语音"
                        >
                          {isRegeneratingVoice ? (
                            <svg
                              className="animate-spin"
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3"
                            >
                              <path d="M21 12a9 9 0 11-6.219-8.56" />
                            </svg>
                          ) : (
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                            >
                              <path d="M1 4v6h6M23 20v-6h-6" />
                              <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />
                            </svg>
                          )}
                        </button>

                        {/* 保存按钮 */}
                        <button
                          onClick={handleSaveVoice}
                          disabled={isSavingVoice}
                          className="w-5 h-5 flex items-center justify-center text-[var(--color-cozy-muted)] hover:text-[#6f9272] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="保存语音"
                        >
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                            <polyline points="17 21 17 13 7 13 7 21" />
                            <polyline points="7 3 7 8 15 8" />
                          </svg>
                        </button>

                        {/* 编辑情绪标签按钮 */}
                        {resourceConfig.voices?.enableEmotionTags && (
                          <button
                            onClick={() => {
                              playSfx();
                              setShowEmotionEditor(true);
                            }}
                            className="w-5 h-5 flex items-center justify-center text-[var(--color-cozy-muted)] hover:text-[var(--color-cozy-accent)] transition-colors duration-150"
                            title="编辑情绪标签"
                          >
                            <PenLine size={10} />
                          </button>
                        )}

                        {/* 取消按钮 */}
                        <button
                          onClick={handleCancelVoice}
                          className="w-5 h-5 flex items-center justify-center text-[var(--color-cozy-muted)] hover:text-[#b86f6f] transition-colors duration-150"
                          title="取消"
                        >
                          <svg
                            width="9"
                            height="9"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                  {/* 可选的右侧点缀（极简细线） */}
                  <div className="flex-1 ml-6 h-[1px] bg-gradient-to-r from-[rgba(161,132,117,0.15)] to-transparent" />
                </div>
              )}

              {/* 字号调整：移动端竖屏 text-[17px]，PC端 md:text-[22px] lg:text-[24px] */}
              <div
                className={`game-dialogue-text relative z-10 font-serif-sc w-full flex-1 overflow-y-auto px-6 pb-4 sm:px-8 sm:pb-5 md:px-10 md:pb-6 text-[17px] leading-[1.65] tracking-[0.02em] scrollbar-none sm:text-[18px] sm:leading-[1.75] md:text-[22px] lg:text-[24px] landscape:!leading-[1.6] ${currentSegment.speaker !== '旁白' ? 'pt-1 landscape:!pt-0' : 'pt-4 sm:pt-5 md:pt-6 landscape:!pt-[18px]'} ${currentSegment.isInnerMonologue ? 'text-[var(--color-cozy-muted)] italic font-medium' : 'text-[var(--color-cozy-ink)] font-normal'}`}
                style={{ fontSize: '17px' }}
              >
                {/* 双语显示：如果有 textJa 和 textZh，分层显示 */}
                {currentSegment.textJa && currentSegment.textZh ? (
                  <div className="flex flex-col gap-0">
                    {/* 日语主文本 */}
                    <div className="text-[var(--color-cozy-ink)]">
                      <span dangerouslySetInnerHTML={{ __html: displayedText }} />
                      {isTyping && (
                        <span className="ml-1 inline-block h-[0.8em] w-[0.8em] rounded-full animate-pulse align-baseline bg-[var(--color-cozy-accent)]" />
                      )}
                    </div>
                    {/* 中文释义（小字、淡色） */}
                    {!isTyping && (
                      <div className="text-[0.75em] leading-relaxed text-[var(--color-cozy-muted)] opacity-80">
                        {currentSegment.textZh}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <span dangerouslySetInnerHTML={{ __html: displayedText }} />
                    {isTyping && (
                      <span className="ml-1 inline-block h-[0.8em] w-[0.8em] rounded-full animate-pulse align-baseline bg-[var(--color-cozy-accent)]" />
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CG 生成进度指示器 */}
      <CGProgressBar progress={cgProgress} />

      {/* CG 全屏查看器 */}
      {showCGViewer && activeCGRange && (
        <CGViewer
          imageBase64={activeCGRange.imageUrl}
          onClose={() => setShowCGViewer(false)}
          fileName={`cg_${messageId ?? 'unknown'}_${activeCGRange.startIndex}-${activeCGRange.endIndex}`}
          prompt={(() => {
            if (!messageId) return undefined;
            // 从范围配方中获取 prompt
            const range = findCGRangeForParagraph(messageId, safeIndex);
            return range?.prompt ?? undefined;
          })()}
          characters={(() => {
            if (!messageId) return undefined;
            // 从范围配方中获取 characters
            const range = findCGRangeForParagraph(messageId, safeIndex);
            return range?.characters ?? undefined;
          })()}
          messageId={messageId ?? undefined}
          paragraphIndex={safeIndex}
          seed={(() => {
            if (!messageId) return undefined;
            const range = findCGRangeForParagraph(messageId, safeIndex);
            return range?.seed ?? undefined;
          })()}
          basePrompt={(() => {
            if (!messageId) return undefined;
            const range = findCGRangeForParagraph(messageId, safeIndex);
            return range?.prompt ?? undefined;
          })()}
          negativePrompt={(() => {
            const { loadCGSettings } = require('../services/cgTaskManager');
            const settings = loadCGSettings();
            return settings.novelAI.negativePrompt;
          })()}
          onImageUpdated={async (newBase64, newSeed) => {
            // 更新当前范围的 CG
            setActiveCGRange({
              ...activeCGRange,
              imageUrl: newBase64,
            });

            // 保存到 IndexedDB 缓存（持久化）
            if (messageId) {
              const { putCGImage, makeRangeCacheKey } = await import('../services/cgCache');
              const cacheKey = makeRangeCacheKey(messageId, activeCGRange.startIndex, activeCGRange.endIndex);
              await putCGImage(cacheKey, newBase64);
            }
          }}
        />
      )}

      {/* 情绪标签编辑器 */}
      {showEmotionEditor && currentSegment && (
        <EmotionTagEditorModal
          isOpen={showEmotionEditor}
          onClose={() => setShowEmotionEditor(false)}
          segment={currentSegment}
          messageId={messageId}
          characterVoices={resourceConfig.voices?.characterVoices || {}}
          onSave={(styleTag, textWithInlineTags) => {
            // 保存后的回调（可选：刷新语音等）
          }}
          playSfx={playSfx}
        />
      )}

      {/* Options slide-in animation */}
      <style>{`
        @keyframes optionSlideIn {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
};
