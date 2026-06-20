import gsap from 'gsap';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CollectionEntry, StatOverride } from '../types';
import { ArrowDownCircle, ArrowUpCircle, Backpack, Info, Sparkles, TrendingUp, Trophy } from './Icons';

export interface StatToastItem {
  id: string;
  icon: 'skill-new' | 'skill-up' | 'item-gain' | 'item-lose' | 'collection' | 'stat-up' | 'stat-down' | 'stat-info';
  text: string;
}

/** 模块级自�?ID，确保跨调用 key 唯一 */
let nextToastId = 0;

/** 不需要弹 toast �?stat path 前缀（如负重变化不需要通知�?*/
const TOAST_IGNORED_PREFIXES = ['负重.', '负重/'];

/** 从前后两�?accumulatedStats 差量中提取技�?背包变化，生�?toast 列表 */
export function diffStatsForToast(prev: StatOverride[], next: StatOverride[]): StatToastItem[] {
  const prevMap = new Map(prev.map(s => [s.path, s]));
  const toasts: StatToastItem[] = [];

  for (const s of next) {
    // 跳过负重等不需要弹 toast �?stat
    if (TOAST_IGNORED_PREFIXES.some(prefix => s.path.startsWith(prefix)) || s.path === '负重') continue;

    const old = prevMap.get(s.path);

    // 技能变化：path 匹配 技�?XXX �?技�?XXX.等级
    const skillMatch = s.path.match(/^技能\.([^.]+)(?:\.等级)?$/);
    if (skillMatch) {
      const name = skillMatch[1];
      if (!old) {
        if (s.mode === 'delta' && typeof s.value === 'number' && s.value > 0) {
          toasts.push({ id: `st_${nextToastId++}`, icon: 'skill-new', text: `习得技能�?{name}」` });
        } else if (s.mode === 'set') {
          toasts.push({ id: `st_${nextToastId++}`, icon: 'skill-new', text: `习得技能�?{name}」` });
        }
      } else if (s.mode === 'delta' && typeof s.value === 'number' && typeof old.value === 'number') {
        if (s.value > old.value) {
          toasts.push({ id: `st_${nextToastId++}`, icon: 'skill-up', text: `�?{name}」技能提升` });
        }
      }
      continue;
    }

    // 背包变化：path 匹配 背包.XXX �?背包.XXX.数量
    const itemMatch = s.path.match(/^背包\.([^.]+)(?:\.数量)?$/);
    if (itemMatch) {
      const name = itemMatch[1];
      if (!old) {
        if (s.mode === 'delta' && typeof s.value === 'number') {
          if (s.value > 0) {
            toasts.push({ id: `st_${nextToastId++}`, icon: 'item-gain', text: `获得�?{name}」�?{s.value}` });
          } else if (s.value < 0) {
            toasts.push({ id: `st_${nextToastId++}`, icon: 'item-lose', text: `失去�?{name}」�?{Math.abs(s.value)}` });
          }
        } else if (s.mode === 'set' && typeof s.value === 'number' && s.value > 0) {
          toasts.push({ id: `st_${nextToastId++}`, icon: 'item-gain', text: `获得�?{name}」�?{s.value}` });
        }
      } else if (s.mode === 'delta' && typeof s.value === 'number' && typeof old.value === 'number') {
        const diff = s.value - old.value;
        if (diff > 0) {
          toasts.push({ id: `st_${nextToastId++}`, icon: 'item-gain', text: `获得�?{name}」�?{diff}` });
        } else if (diff < 0) {
          toasts.push({ id: `st_${nextToastId++}`, icon: 'item-lose', text: `失去�?{name}」�?{Math.abs(diff)}` });
        }
      }
      continue;
    }

    // 处理其他基础属性的变化（忽略好感度等带有层级的角色变量�?    // 我们忽略带有特殊前缀（已�?TOAST_IGNORED_PREFIXES 拦截），忽略隐藏变量，也忽略包含 '.' 的属性（�?"付觉�?信任�?�?    if (s.path.startsWith('_') || s.path.includes('.')) continue;

    const displayName = s.path;

    if (!old) {
      if (s.mode === 'delta' && typeof s.value === 'number') {
        if (s.value > 0) {
          toasts.push({ id: `st_${nextToastId++}`, icon: 'stat-up', text: `${displayName} +${s.value}` });
        } else if (s.value < 0) {
          toasts.push({ id: `st_${nextToastId++}`, icon: 'stat-down', text: `${displayName} ${s.value}` });
        }
      } else if (s.mode === 'set') {
        toasts.push({ id: `st_${nextToastId++}`, icon: 'stat-info', text: `${displayName}变更为�?{s.value}」` });
      }
    } else if (typeof s.value === 'number' && typeof old.value === 'number') {
      const diff = s.value - old.value;
      if (diff > 0) {
        toasts.push({ id: `st_${nextToastId++}`, icon: 'stat-up', text: `${displayName} +${diff}` });
      } else if (diff < 0) {
        toasts.push({ id: `st_${nextToastId++}`, icon: 'stat-down', text: `${displayName} ${diff}` });
      }
    } else if (s.value !== old.value) {
      toasts.push({ id: `st_${nextToastId++}`, icon: 'stat-info', text: `${displayName}变更为�?{s.value}」` });
    }
  }

  return toasts;
}

const ICON_MAP: Record<StatToastItem['icon'], React.ReactNode> = {
  'skill-new': <Sparkles size={14} />,
  'skill-up': <TrendingUp size={14} />,
  'item-gain': <Backpack size={14} />,
  'item-lose': <Backpack size={14} />,
  collection: <Trophy size={14} />,
  'stat-up': <ArrowUpCircle size={14} />,
  'stat-down': <ArrowDownCircle size={14} />,
  'stat-info': <Info size={14} />,
};

/** 粒子颜色（hex�?黑白灰单色调 */
const PARTICLE_COLORS: Record<StatToastItem['icon'], string> = {
  'skill-new': '#ffffff',
  'skill-up': '#e2e8f0',
  'item-gain': '#f8fafc',
  'item-lose': '#94a3b8',
  collection: '#ffffff',
  'stat-up': '#e2e8f0',
  'stat-down': '#94a3b8',
  'stat-info': '#cbd5e1',
};

/** toast 条的高级半透明单色调样式（黑白灰主题，去框线、模糊渐变） */
const TOAST_STYLES: Record<
  StatToastItem['icon'],
  { bgGradient: string; text: string; iconColor: string; titleEn: string }
> = {
  'skill-new': {
    bgGradient: 'linear-gradient(90deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.02) 100%)',
    text: '#ffffff',
    iconColor: '#ffffff',
    titleEn: 'SKILL ACQUIRED',
  },
  'skill-up': {
    bgGradient: 'linear-gradient(90deg, rgba(226,232,240,0.1) 0%, rgba(226,232,240,0.01) 100%)',
    text: '#e2e8f0',
    iconColor: '#e2e8f0',
    titleEn: 'SKILL UP',
  },
  'item-gain': {
    bgGradient: 'linear-gradient(90deg, rgba(248,250,252,0.1) 0%, rgba(248,250,252,0.01) 100%)',
    text: '#f8fafc',
    iconColor: '#f8fafc',
    titleEn: 'ITEM OBTAINED',
  },
  'item-lose': {
    bgGradient: 'linear-gradient(90deg, rgba(148,163,184,0.08) 0%, rgba(148,163,184,0.01) 100%)',
    text: '#94a3b8',
    iconColor: '#94a3b8',
    titleEn: 'ITEM LOST',
  },
  collection: {
    bgGradient: 'linear-gradient(90deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.02) 100%)',
    text: '#ffffff',
    iconColor: '#ffffff',
    titleEn: 'COLLECTION UNLOCKED',
  },
  'stat-up': {
    bgGradient: 'linear-gradient(90deg, rgba(226,232,240,0.1) 0%, rgba(226,232,240,0.01) 100%)',
    text: '#e2e8f0',
    iconColor: '#e2e8f0',
    titleEn: 'STAT INCREASED',
  },
  'stat-down': {
    bgGradient: 'linear-gradient(90deg, rgba(148,163,184,0.08) 0%, rgba(148,163,184,0.01) 100%)',
    text: '#94a3b8',
    iconColor: '#94a3b8',
    titleEn: 'STAT DECREASED',
  },
  'stat-info': {
    bgGradient: 'linear-gradient(90deg, rgba(203,213,225,0.08) 0%, rgba(203,213,225,0.01) 100%)',
    text: '#cbd5e1',
    iconColor: '#cbd5e1',
    titleEn: 'STAT UPDATED',
  },
};

/** 从收集条目生�?toast */
export function collectionToToasts(collections: CollectionEntry[]): StatToastItem[] {
  return collections.map(c => ({
    id: `col_${nextToastId++}`,
    icon: 'collection' as const,
    text: `解锁${c.type}�?{c.title}」`,
  }));
}

/** �?container 内生成粒子并�?GSAP 驱动飘散 */
function spawnParticles(container: HTMLElement, color: string, count: number, direction: 'enter' | 'exit') {
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    const size = 2 + Math.random() * 1.5; // 2-3.5px
    p.style.cssText = `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      background: ${color};
      box-shadow: 0 0 ${size * 2}px ${color}, 0 0 ${size * 4}px ${color}40;
      pointer-events: none;
      z-index: 5;
    `;

    const rect = container.getBoundingClientRect();

    if (direction === 'enter') {
      // 入场粒子：从左边缘和底部生成
      const fromLeft = Math.random() < 0.6;
      if (fromLeft) {
        p.style.left = `${-2 + Math.random() * 8}px`;
        p.style.top = `${Math.random() * rect.height}px`;
      } else {
        p.style.left = `${Math.random() * rect.width * 0.5}px`;
        p.style.top = `${rect.height - 2 + Math.random() * 4}px`;
      }
    } else {
      // 消散粒子：从 toast 整体区域随机位置生成
      p.style.left = `${Math.random() * rect.width}px`;
      p.style.top = `${Math.random() * rect.height * 0.8}px`;
    }

    container.appendChild(p);

    const dx =
      direction === 'enter'
        ? -(15 + Math.random() * 25) // 入场：向左飘移
        : (Math.random() - 0.5) * 30; // 消散：随机水平
    const dy =
      direction === 'enter'
        ? (Math.random() - 0.5) * 30 // 入场：随机上下
        : -(20 + Math.random() * 30); // 消散：向上飘移
    const duration = direction === 'enter' ? 0.8 + Math.random() * 0.7 : 0.6 + Math.random() * 0.6;

    gsap.to(p, {
      x: dx,
      y: dy,
      opacity: 0,
      scale: 0.2,
      duration,
      delay: Math.random() * 0.15,
      ease: 'power2.out',
      onComplete: () => p.remove(),
    });
  }
}

/** 单个 toast 条组件，自带完整 GSAP 生命周期 */
const FloatingToast: React.FC<{
  item: StatToastItem;
  onDone: (id: string) => void;
}> = ({ item, onDone }) => {
  const elRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const style = TOAST_STYLES[item.icon];
  const particleColor = PARTICLE_COLORS[item.icon];

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const tl = gsap.timeline({
      onComplete: () => onDone(item.id),
    });
    tlRef.current = tl;

    // Phase 1: 入场 (0 - 0.6s)
    // 初始状态
    gsap.set(el, {
      x: -30,
      opacity: 0,
      y: (Math.random() - 0.5) * 6, // 随机 Y 偏移
    });

    tl.to(el, {
      x: 0,
      opacity: 1,
      duration: 0.5,
      ease: 'power3.out',
      onStart: () => spawnParticles(el, particleColor, 6, 'enter'),
    });

    // 图标弹入
    const iconEl = el.querySelector('.toast-icon');
    if (iconEl) {
      gsap.set(iconEl, { scale: 0, rotation: -30 });
      tl.to(
        iconEl,
        {
          scale: 1,
          rotation: 0,
          duration: 0.35,
          ease: 'back.out(2)',
        },
        '<0.1',
      );
    }

    // Phase 2: 漂浮停留 (0.6s - 3s)
    // 呼吸浮动
    tl.to(
      el,
      {
        y: '-=4',
        duration: 1.2,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: 1,
      },
      '>',
    );

    // 图标呼吸
    if (iconEl) {
      tl.to(
        iconEl,
        {
          scale: 1.15,
          duration: 0.9,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: 1,
        },
        '<',
      );
    }

    // Phase 3: 消散 (2.5s - 3.5s)
    tl.to(
      el,
      {
        y: '-=15',
        opacity: 0,
        filter: 'blur(2px)',
        duration: 0.8,
        ease: 'power2.in',
        onStart: () => spawnParticles(el, particleColor, 5, 'exit'),
      },
      '>',
    );

    return () => {
      tl.kill();
    };
  }, []);

  return (
    <div
      ref={elRef}
      className="relative flex items-start gap-2 sm:gap-3 py-2 sm:py-3 pl-1 sm:pl-2 pr-4 sm:pr-8 font-serif-sc pointer-events-none select-none"
      style={{
        opacity: 0, // GSAP 会控制
      }}
    >
      {/* 绝对无背景、无框的设计。仅靠排版和装饰 */}

      {/* 左侧极其细微的准星式标点/竖线 */}
      <div className="absolute left-0 top-[10px] sm:top-[14px] flex flex-col items-center gap-0.5 sm:gap-1 opacity-60">
        <div className="w-[1px] h-2 sm:h-3 bg-gradient-to-b from-transparent to-white" />
        <div className="w-[2px] sm:w-[3px] h-[2px] sm:h-[3px] bg-white transform rotate-45 shadow-[0_0_3px_white] sm:shadow-[0_0_4px_white]" />
        <div className="w-[1px] h-[12px] sm:h-[20px] bg-gradient-to-b from-white to-transparent" />
      </div>

      {/* 图标部分：裸露图标，带辉光但不带底框 */}
      <div
        className="toast-icon relative z-10 flex items-center justify-center mt-[10px] sm:mt-[15px]"
        style={{ color: style.iconColor }}
      >
        <div className="relative z-10 opacity-80 drop-shadow-[0_0_4px_rgba(255,255,255,0.5)] sm:drop-shadow-[0_0_6px_rgba(255,255,255,0.5)] scale-75 sm:scale-100">
          {ICON_MAP[item.icon]}
        </div>
      </div>

      {/* 文本区域：纯靠阴影保证在复杂背景下的可读性 */}
      <div className="flex flex-col z-10">
        <div className="flex items-center gap-1.5 sm:gap-3">
          <span className="text-[7px] sm:text-[10px] uppercase tracking-[0.2em] sm:tracking-[0.3em] text-white/60 font-mono leading-none shadow-black drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
            {style.titleEn}
          </span>
          {/* 水平延展的装饰虚线，不用来封口，只是一种引导视线的元素 */}
          <div
            className="h-[1px] flex-grow w-8 sm:w-16 bg-[length:4px_1px] bg-repeat-x opacity-40"
            style={{ backgroundImage: 'linear-gradient(to right, white 50%, transparent 50%)' }}
          />
        </div>

        <span className="text-[11px] sm:text-[16px] text-white tracking-[0.1em] sm:tracking-[0.15em] font-light mt-1 sm:mt-1.5 whitespace-nowrap drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] [text-shadow:0_0_6px_rgba(255,255,255,0.3)] sm:[text-shadow:0_0_8px_rgba(255,255,255,0.3)]">
          {item.text}
        </span>
      </div>
    </div>
  );
};

interface StatToastOverlayProps {
  accumulatedStats: StatOverride[];
  accumulatedCollections: CollectionEntry[];
  isForward: boolean;
}

export const StatToastOverlay: React.FC<StatToastOverlayProps> = ({
  accumulatedStats,
  accumulatedCollections,
  isForward,
}) => {
  const [toasts, setToasts] = useState<StatToastItem[]>([]);
  const prevStatsRef = useRef<StatOverride[]>([]);
  const prevStatsKeyRef = useRef('');
  const prevCollectionsRef = useRef<CollectionEntry[]>([]);
  const prevCollectionsKeyRef = useRef('');

  useEffect(() => {
    const key = JSON.stringify(accumulatedStats);
    if (key === prevStatsKeyRef.current) return;

    const prev = prevStatsRef.current;
    prevStatsRef.current = accumulatedStats;
    prevStatsKeyRef.current = key;

    // 只在向前推进时弹 toast
    if (!isForward) return;

    const newToasts = diffStatsForToast(prev, accumulatedStats);
    if (newToasts.length === 0) return;

    setToasts(ts => [...ts, ...newToasts]);
  }, [accumulatedStats, isForward]);

  // 收集条目变化时弹 toast
  useEffect(() => {
    const key = JSON.stringify(accumulatedCollections);
    if (key === prevCollectionsKeyRef.current) return;

    const prev = prevCollectionsRef.current;
    prevCollectionsRef.current = accumulatedCollections;
    prevCollectionsKeyRef.current = key;

    if (!isForward) return;

    // 找出新增的收集条目（prev 中没有的）
    const prevKeys = new Set(prev.map(c => `${c.type}:${c.title}`));
    const newCollections = accumulatedCollections.filter(c => !prevKeys.has(`${c.type}:${c.title}`));
    if (newCollections.length === 0) return;

    const newToasts = collectionToToasts(newCollections);
    setToasts(ts => [...ts, ...newToasts]);
  }, [accumulatedCollections, isForward]);

  const handleToastDone = useCallback((id: string) => {
    setToasts(ts => ts.filter(t => t.id !== id));
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="game-stat-toast absolute bottom-[8%] left-0 pl-2 sm:pl-8 z-30 flex flex-col gap-2 sm:gap-4 pointer-events-none w-[55vw] max-w-[280px] sm:max-w-[380px]">
      {toasts.map(t => (
        <FloatingToast key={t.id} item={t} onDone={handleToastDone} />
      ))}
    </div>
  );
};
