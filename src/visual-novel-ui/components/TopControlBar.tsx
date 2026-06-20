import {
  BookOpen,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Dice5,
  FastForward,
  FolderOpen,
  Fullscreen,
  History,
  Loader2,
  Menu,
  Minimize2,
  Play,
  Rewind,
  Settings,
  Volume2,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { abortCGGeneration } from '../services/cgTaskManager';
import { CGTaskProgress, GameSettings } from '../types';

const DRAWER_LABELS: Record<string, { primary: string; secondary: string }> = {
  ROLL: { primary: '重掷', secondary: 'Roll' },
  LOG: { primary: '记录', secondary: 'Log' },
  AUTO: { primary: '自动', secondary: 'Auto' },
  '3x': { primary: '加速', secondary: '3×' },
  STATUS: { primary: '状态', secondary: 'Status' },
  LOAD: { primary: '存读', secondary: 'Load' },
  BOND: { primary: '羁绊', secondary: 'Bond' },
  ARCHIVE: { primary: '收藏', secondary: 'Archive' },
  SYSTEM: { primary: '设置', secondary: 'System' },
  CG_CFG: { primary: 'CG配置', secondary: 'CG Config' },
  VOICE_CFG: { primary: '语音配置', secondary: 'Voice' },
  FULL: { primary: '全屏', secondary: 'Full' },
  WIND: { primary: '窗口', secondary: 'Window' },
};

// ====== 纯图标按钮（常驻栏用）=====
const TopIconButton: React.FC<{
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  playSfx: () => void;
  active?: boolean;
}> = ({ icon, title, onClick, playSfx, active }) => (
  <button
    title={title}
    onClick={e => {
      e.stopPropagation();
      playSfx();
      onClick();
    }}
    className={`
      flex shrink-0 items-center justify-center w-11 h-11 min-w-11 min-h-11 rounded-[18px]
      transition-all duration-300 cursor-pointer overflow-hidden relative border
      ${
        active
          ? 'cozy-surface text-[var(--color-cozy-ink)] border-[color:var(--color-cozy-border-strong)] shadow-[0_16px_34px_rgba(109,88,76,0.2)]'
          : 'bg-[rgba(255,250,246,0.54)] text-[var(--color-cozy-muted)] border-[color:rgba(161,132,117,0.18)] shadow-[0_10px_24px_rgba(109,88,76,0.12)] backdrop-blur-md hover:-translate-y-0.5 hover:text-[var(--color-cozy-ink)] hover:bg-[rgba(255,252,248,0.84)] hover:border-[color:rgba(161,132,117,0.28)] hover:shadow-[0_16px_30px_rgba(109,88,76,0.16)]'
      }
    `}
  >
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.7),transparent_72%)] opacity-80" />
    <div className="absolute inset-x-2 bottom-1 h-px cozy-hairline opacity-60" />
    <span className="relative z-10 drop-shadow-sm">{icon}</span>
  </button>
);

// ====== 抽屉内网格按钮 ======
const DrawerButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  playSfx: () => void;
  active?: boolean;
  loading?: boolean;
  index: number;
}> = ({ icon, label, onClick, playSfx, active, loading, index }) => {
  const labelText = DRAWER_LABELS[label] ?? { primary: label, secondary: label };

  return (
    <button
      onClick={e => {
        e.stopPropagation();
        playSfx();
        onClick();
      }}
      className={`
      group flex flex-col items-center justify-center gap-2 py-4 rounded-[20px] relative overflow-hidden
      transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] cursor-pointer border
      ${
        active
          ? 'cozy-surface text-[var(--color-cozy-ink)] border-[color:var(--color-cozy-border-strong)] shadow-[0_18px_36px_rgba(109,88,76,0.18)]'
          : 'bg-[rgba(255,252,248,0.6)] border-[color:rgba(161,132,117,0.14)] text-[var(--color-cozy-muted)] shadow-[0_12px_24px_rgba(109,88,76,0.1)] backdrop-blur-md hover:-translate-y-1 hover:text-[var(--color-cozy-ink)] hover:bg-[rgba(255,250,246,0.86)] hover:border-[color:rgba(161,132,117,0.3)] hover:shadow-[0_18px_36px_rgba(109,88,76,0.16)]'
      }
    `}
      style={{
        animation: `fade-in 0.4s ease-out forwards`,
        animationDelay: `${index * 40}ms`,
        opacity: 0,
        transform: 'translateY(10px)',
      }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.74),transparent_72%)] opacity-90" />
      <div className="absolute inset-x-3 top-0 h-px cozy-hairline opacity-80" />
      <div className="absolute inset-x-4 bottom-3 h-px cozy-hairline opacity-40" />

      <div className="relative z-10 transition-transform duration-300 group-hover:scale-110 drop-shadow-sm">
        {loading ? <Loader2 size={18} className="animate-spin text-[var(--color-cozy-muted)]" /> : icon}
      </div>
      <div className="relative z-10 flex flex-col items-center gap-0.5 leading-none">
        <span className="font-serif-sc text-[12px] tracking-[0.08em] text-[var(--color-cozy-ink)]">
          {labelText.primary}
        </span>
        <span className="font-mono-retro text-[8px] uppercase tracking-[0.24em] text-[var(--color-cozy-muted)] group-hover:tracking-[0.28em] transition-all duration-300">
          {labelText.secondary}
        </span>
      </div>
    </button>
  );
};

// ====== 侧边抽屉 ======
const SideDrawer: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ isOpen, onClose, children }) => {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
      return;
    } else {
      setVisible(false);
      const timer = setTimeout(() => setMounted(false), 350);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!mounted) return null;

  return (
    <div className="absolute inset-0 z-[35]">
      {/* 遮罩 */}
      <div
        className={`absolute inset-0 transition-all duration-350 ${visible ? 'bg-[rgba(79,60,52,0.24)] backdrop-blur-[2px]' : 'bg-transparent'}`}
        onClick={onClose}
      />
      <div
        className={`
          game-side-drawer absolute top-3 right-3 bottom-3 w-[18rem] rounded-[28px]
          cozy-surface text-[var(--color-cozy-ink)]
          flex flex-col overflow-hidden
          transition-all duration-[400ms] ease-[cubic-bezier(0.16,1,0.3,1)]
          ${visible ? 'translate-x-0 opacity-100' : 'translate-x-[108%] opacity-0'}
        `}
      >
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.55),transparent_22%,transparent_78%,rgba(221,184,176,0.12))] pointer-events-none" />
        <div className="absolute top-0 right-0 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(221,184,176,0.26),transparent_68%)] blur-2xl pointer-events-none" />
        <div className="absolute -left-8 bottom-12 h-32 w-32 rounded-full bg-[radial-gradient(circle,rgba(188,199,186,0.2),transparent_70%)] blur-2xl pointer-events-none" />
        <div className="absolute left-0 top-6 bottom-6 w-px bg-[linear-gradient(180deg,transparent,rgba(161,132,117,0.28),transparent)]" />

        <div className="relative flex items-center justify-between px-6 pt-7 pb-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2.5">
              <div className="relative flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(255,255,255,0.62)] border border-[rgba(161,132,117,0.16)] shadow-[0_8px_18px_rgba(109,88,76,0.12)]">
                <div className="h-2 w-2 rounded-full bg-[var(--color-cozy-accent)]" />
                <div className="absolute inset-[4px] rounded-full border border-[rgba(221,184,176,0.35)]" />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-serif-sc text-[15px] text-[var(--color-cozy-ink)] tracking-[0.08em]">菜单</span>
                <span className="font-mono-retro text-[8px] uppercase tracking-[0.24em] text-[var(--color-cozy-muted)]">
                  story palette
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="group flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(161,132,117,0.18)] bg-[rgba(255,255,255,0.48)] text-[var(--color-cozy-muted)] shadow-[0_10px_24px_rgba(109,88,76,0.12)] transition-all duration-300 cursor-pointer hover:-translate-y-0.5 hover:text-[var(--color-cozy-ink)] hover:bg-[rgba(255,255,255,0.74)] hover:border-[rgba(161,132,117,0.28)]"
          >
            <X size={14} className="transition-transform duration-300 group-hover:rotate-90" />
          </button>
        </div>

        <div className="mx-6 h-px cozy-hairline relative opacity-80">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 h-[2px] w-10 rounded-full bg-[rgba(221,184,176,0.55)]" />
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-6 cozy-scrollbar">
          <div className="grid grid-cols-2 gap-3">{children}</div>
        </div>

        <div className="mx-6 h-px cozy-hairline relative opacity-60">
          <div className="absolute right-0 top-1/2 -translate-y-1/2 h-[2px] w-6 rounded-full bg-[rgba(188,199,186,0.55)]" />
        </div>
        <div className="relative px-6 py-5 flex items-center justify-between">
          <div className="flex flex-col gap-1 leading-none">
            <span className="font-serif-sc text-[11px] text-[var(--color-cozy-ink)] tracking-[0.08em]">
              quiet editor ui
            </span>
            <span className="font-mono-retro text-[8px] uppercase tracking-[0.22em] text-[var(--color-cozy-muted)]">
              visual trial
            </span>
          </div>
          <div className="flex gap-1.5 opacity-70">
            <div className="h-2 w-2 rounded-full bg-[var(--color-cozy-accent)]" />
            <div className="h-2 w-2 rounded-full bg-[var(--color-cozy-accent-soft)]" />
            <div className="h-2 w-2 rounded-full bg-[var(--color-cozy-accent-green)]" />
          </div>
        </div>
      </div>
    </div>
  );
};

// ====== 主组�?======
interface TopControlBarProps {
  settings: GameSettings;
  onToggleSetting: (setting: keyof GameSettings) => void;
  onShowLog: () => void;
  onShowStatus: () => void;
  onShowSettings: () => void;
  onShowSaveLoad: () => void;
  onShowCollection: () => void;
  onShowRelationship: () => void;
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
  playSfx: () => void;
  onShowCGConfig?: () => void;
  onShowVoiceConfig?: () => void;
  onBack: () => void;
  onRoll: () => void;
  isRolling: boolean;
  currentSwipeId: number;
  totalSwipes: number;
  onSwipeNav: (direction: 'prev' | 'next') => void;
  onCommitRoll: () => Promise<void>;
  onTriggerCG?: () => void;
  cgProgress?: CGTaskProgress;
}

export const TopControlBar: React.FC<TopControlBarProps> = ({
  settings,
  onToggleSetting,
  onShowLog,
  onShowStatus,
  onShowSettings,
  onShowSaveLoad,
  onShowCollection,
  onShowRelationship,
  onToggleFullscreen,
  isFullscreen,
  playSfx,
  onShowCGConfig,
  onShowVoiceConfig,
  onBack,
  onRoll,
  isRolling,
  currentSwipeId,
  totalSwipes,
  onSwipeNav,
  onCommitRoll,
  onTriggerCG,
  cgProgress,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const withDrawerClose = useCallback((fn: () => void) => {
    return () => {
      fn();
      setDrawerOpen(false);
    };
  }, []);

  const stopPropagation = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <>
      {/* 常驻按钮�?*/}
      <div
        className="game-top-controls absolute top-6 right-8 z-30 flex items-center gap-2.5"
        onClick={stopPropagation}
      >
        {/* BACK */}
        <TopIconButton icon={<Rewind size={18} />} title="回退 (BACK)" onClick={onBack} playSfx={playSfx} />

        {/* CG 生图 */}
        {onTriggerCG && (
          <TopIconButton
            icon={
              cgProgress?.status === 'analyzing' || cgProgress?.status === 'generating' ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Camera size={18} />
              )
            }
            title={
              cgProgress?.status === 'analyzing'
                ? '导演分析�?..（点击中断）'
                : cgProgress?.status === 'generating'
                  ? `生成�?${cgProgress.completed ?? 0}/${cgProgress.total ?? 0}（点击中断）`
                  : '导演扫描生图'
            }
            onClick={() => {
              // 如果正在生成，点击则中断
              if (cgProgress?.status === 'analyzing' || cgProgress?.status === 'generating') {
                abortCGGeneration();
              } else {
                // 否则触发生成
                onTriggerCG();
              }
            }}
            playSfx={playSfx}
            active={cgProgress?.status === 'analyzing' || cgProgress?.status === 'generating'}
          />
        )}

        {/* Swipe 导航器（条件显示）�?半透明高级胶囊�?*/}
        {totalSwipes > 1 && (
          <div className="cozy-surface flex h-11 items-center overflow-hidden rounded-[20px] border-[color:rgba(161,132,117,0.22)] shadow-[0_16px_30px_rgba(109,88,76,0.16)]">
            <button
              onClick={() => {
                playSfx();
                onSwipeNav('prev');
              }}
              disabled={currentSwipeId <= 0}
              className="h-full px-3 flex items-center justify-center text-[var(--color-cozy-muted)] hover:text-[var(--color-cozy-ink)] hover:bg-[rgba(255,255,255,0.38)] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer"
            >
              <ChevronLeft size={16} />
            </button>

            <div className="mx-1 h-4 w-px bg-[rgba(161,132,117,0.18)]" />

            <span className="font-mono-retro text-[11px] text-[var(--color-cozy-ink)] tracking-widest px-3 select-none flex gap-1 items-center font-bold">
              <span className="text-[var(--color-cozy-ink)]">{currentSwipeId + 1}</span>
              <span className="opacity-35">/</span>
              <span className="text-[var(--color-cozy-muted)]">{totalSwipes}</span>
            </span>

            <div className="mx-1 h-4 w-px bg-[rgba(161,132,117,0.18)]" />

            <button
              onClick={() => {
                playSfx();
                onSwipeNav('next');
              }}
              disabled={currentSwipeId >= totalSwipes - 1}
              className="h-full px-3 flex items-center justify-center text-[var(--color-cozy-muted)] hover:text-[var(--color-cozy-ink)] hover:bg-[rgba(255,255,255,0.38)] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer"
            >
              <ChevronRight size={16} />
            </button>

            <div className="h-full w-px bg-gradient-to-b from-transparent via-[rgba(161,132,117,0.22)] to-transparent" />

            <button
              onClick={() => {
                playSfx();
                onCommitRoll();
              }}
              title="确认选用当前结果"
              className="relative group flex h-full items-center justify-center px-4 text-[var(--color-cozy-muted)] hover:text-[var(--color-cozy-ink)] hover:bg-[rgba(255,255,255,0.38)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)] transition-all duration-200 cursor-pointer"
            >
              <Check size={16} className="group-hover:scale-110 transition-transform" />
            </button>
          </div>
        )}

        {/* 菜单触发按钮 */}
        <TopIconButton
          icon={<Menu size={18} />}
          title="菜单 (MENU)"
          onClick={() => setDrawerOpen(true)}
          playSfx={playSfx}
        />
      </div>

      {/* 侧边抽屉 */}
      <SideDrawer
        isOpen={drawerOpen}
        onClose={() => {
          playSfx();
          setDrawerOpen(false);
        }}
      >
        <DrawerButton
          index={0}
          icon={<Dice5 size={18} strokeWidth={1.5} />}
          label="ROLL"
          onClick={withDrawerClose(onRoll)}
          playSfx={playSfx}
          loading={isRolling}
        />
        <DrawerButton
          index={1}
          icon={<History size={18} strokeWidth={1.5} />}
          label="LOG"
          onClick={withDrawerClose(onShowLog)}
          playSfx={playSfx}
        />
        <DrawerButton
          index={2}
          icon={<Play size={18} strokeWidth={1.5} />}
          label="AUTO"
          onClick={withDrawerClose(() => onToggleSetting('autoPlay'))}
          playSfx={playSfx}
          active={settings.autoPlay}
        />
        <DrawerButton
          index={3}
          icon={<FastForward size={18} strokeWidth={1.5} />}
          label="3x"
          onClick={withDrawerClose(() => onToggleSetting('speed'))}
          playSfx={playSfx}
          active={settings.speed === 2}
        />
        <DrawerButton
          index={4}
          icon={<FolderOpen size={18} strokeWidth={1.5} />}
          label="LOAD"
          onClick={withDrawerClose(onShowSaveLoad)}
          playSfx={playSfx}
        />
        <DrawerButton
          index={5}
          icon={<BookOpen size={18} strokeWidth={1.5} />}
          label="ARCHIVE"
          onClick={withDrawerClose(onShowCollection)}
          playSfx={playSfx}
        />
        <DrawerButton
          index={6}
          icon={<Settings size={18} strokeWidth={1.5} />}
          label="SYSTEM"
          onClick={withDrawerClose(onShowSettings)}
          playSfx={playSfx}
        />
        {onShowCGConfig && (
          <DrawerButton
            index={7}
            icon={<Camera size={18} strokeWidth={1.5} />}
            label="CG_CFG"
            onClick={withDrawerClose(onShowCGConfig)}
            playSfx={playSfx}
          />
        )}
        {onShowVoiceConfig && (
          <DrawerButton
            index={onShowCGConfig ? 8 : 7}
            icon={<Volume2 size={18} strokeWidth={1.5} />}
            label="VOICE_CFG"
            onClick={withDrawerClose(onShowVoiceConfig)}
            playSfx={playSfx}
          />
        )}
        <DrawerButton
          index={onShowCGConfig && onShowVoiceConfig ? 9 : onShowCGConfig || onShowVoiceConfig ? 8 : 7}
          icon={isFullscreen ? <Minimize2 size={18} strokeWidth={1.5} /> : <Fullscreen size={18} strokeWidth={1.5} />}
          label={isFullscreen ? 'WIND' : 'FULL'}
          onClick={withDrawerClose(onToggleFullscreen)}
          playSfx={playSfx}
        />
      </SideDrawer>
    </>
  );
};
