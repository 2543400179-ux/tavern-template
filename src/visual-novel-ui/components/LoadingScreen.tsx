/**
 * LoadingScreen - 可爱的资源预加载界面
 * 显示 CG、语音、背景和立绘的生成进度，带有跳动的低饱和彩色点动画
 */

import React from 'react';
import type { PreloadProgress } from '../services/preloadService';

interface LoadingScreenProps {
  progress: PreloadProgress;
  onClose?: () => void;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ progress, onClose }) => {
  const { 
    phase, 
    cgTotal, cgCompleted, cgCached, 
    voiceTotal, voiceCompleted, voiceCached,
    bgTotal, bgCompleted, bgCached,
    spriteTotal, spriteCompleted, spriteCached,
    currentTask, 
    error 
  } = progress;

  // 计算总体进度百分比
  const totalTasks = cgTotal + voiceTotal + bgTotal + spriteTotal;
  const completedTasks = cgCompleted + voiceCompleted + bgCompleted + spriteCompleted;
  const percentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[rgba(255,250,246,0.95)] transition-opacity duration-500 animate-in fade-in md:backdrop-blur-[24px] md:bg-[rgba(255,250,246,0.88)]">
      {/* 呼吸感背景装饰 */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute -left-[10%] top-[8%] h-[40%] w-[40%] rounded-full bg-[rgba(221,184,176,0.20)] blur-[100px] animate-pulse"
          style={{ animationDuration: '8s' }}
        />
        <div
          className="absolute right-[-12%] bottom-[12%] h-[36%] w-[36%] rounded-full bg-[rgba(188,199,186,0.20)] blur-[90px] animate-pulse"
          style={{ animationDuration: '10s', animationDelay: '2s' }}
        />
        <div
          className="absolute left-[20%] bottom-[20%] h-[28%] w-[28%] rounded-full bg-[rgba(212,196,165,0.18)] blur-[80px] animate-pulse"
          style={{ animationDuration: '12s', animationDelay: '4s' }}
        />
      </div>

      {/* 主内容区 */}
      <div className="relative flex flex-col items-center gap-5 w-full max-w-[520px] px-8 mt-16">

        {/* 错误状态 */}
        {error ? (
          <>
            <div className="text-6xl mb-2">😢</div>
            <h2 className="font-serif-sc text-2xl text-[var(--color-cozy-ink)] text-center tracking-wider">加载遇到了问题</h2>
            <p className="text-sm text-[var(--color-cozy-muted)] text-center max-w-sm leading-relaxed mt-2">{error}</p>
            {onClose && (
              <button
                onClick={onClose}
                className="mt-6 px-8 py-3 rounded-[20px] bg-[var(--color-cozy-accent)] text-white font-serif-sc text-sm tracking-[0.1em] transition-all duration-300 hover:scale-105 hover:shadow-[0_8px_20px_rgba(221,184,176,0.4)]"
              >
                继续浏览
              </button>
            )}
          </>
        ) : phase === 'done' ? (
          <>
            {/* 完成状态 */}
            <div className="text-6xl animate-bounce mb-2 -mt-12">✨</div>
            <h2 className="font-serif-sc text-2xl text-[var(--color-cozy-ink)] tracking-wider">准备就绪！</h2>
            <p className="text-sm text-[var(--color-cozy-muted)] text-center leading-relaxed mt-2">
              {currentTask || '开始您的旅程吧～'}
            </p>
          </>
        ) : (
          <>
            {/* 1. 彩色点跳动 - 最上方 */}
            <div className="flex items-center justify-center gap-3 h-12">
              <div
                className="h-3 w-3 rounded-full bg-[#ddb8b0]"
                style={{
                  animation: 'coloredBounce 1.4s infinite ease-in-out both',
                  animationDelay: '0s'
                }}
              />
              <div
                className="h-3 w-3 rounded-full bg-[#d4c4b0]"
                style={{
                  animation: 'coloredBounce 1.4s infinite ease-in-out both',
                  animationDelay: '0.2s'
                }}
              />
              <div
                className="h-3 w-3 rounded-full bg-[#bcd4c4]"
                style={{
                  animation: 'coloredBounce 1.4s infinite ease-in-out both',
                  animationDelay: '0.4s'
                }}
              />
              <div
                className="h-3 w-3 rounded-full bg-[#b0c4d4]"
                style={{
                  animation: 'coloredBounce 1.4s infinite ease-in-out both',
                  animationDelay: '0.6s'
                }}
              />
            </div>

            {/* 2. 进度条 */}
            <div className="w-full space-y-2.5">
              {/* 进度条本体 */}
              <div className="relative h-2 w-full rounded-full bg-[rgba(161,132,117,0.15)] overflow-hidden">
                <div
                  className="absolute left-0 top-0 h-full rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: `${percentage}%`,
                    background: 'linear-gradient(90deg, #ddb8b0 0%, #d4c4b0 33%, #bcd4c4 66%, #b0c4d4 100%)',
                    boxShadow: '0 0 16px rgba(221,184,176,0.5)'
                  }}
                />
              </div>

              {/* 进度百分比 - 进度条正下方 */}
              <div className="flex items-center justify-center">
                <span className="font-mono-retro text-base text-[var(--color-cozy-ink)] font-light tracking-wide opacity-60">
                  {percentage}<span className="text-sm opacity-60">%</span>
                </span>
              </div>
            </div>

            {/* 3. 文字tips - 进度条下方，缩减间距 */}
            <div className="w-full flex items-center justify-center min-h-[32px] -mt-2">
              <p className="font-serif-sc text-xs text-[var(--color-cozy-muted)] text-center tracking-wide leading-relaxed px-6">
                {currentTask || (phase === 'idle' ? '正在准备资源...' : phase === 'checking' ? '正在检查已有资源...' : phase === 'resources' ? '正在加载图片资源...' : phase === 'cg' ? '正在构筑世界画面...' : phase === 'voice' ? '正在倾听角色声音...' : '加载中...')}
              </p>
            </div>

            {/* 4. 资源统计 - 最底部，固定高度避免布局抖动 */}
            <div className="flex items-center justify-center gap-6 min-h-[72px] -mt-2">
              <div
                className="flex items-center gap-6 transition-opacity duration-700 flex-wrap justify-center"
                style={{ opacity: (bgTotal > 0 || spriteTotal > 0 || cgTotal > 0 || voiceTotal > 0) ? 1 : 0 }}
              >
                {bgTotal > 0 && (
                  <div className="flex flex-col items-center gap-1">
                    <span className="font-mono-retro text-[8px] uppercase tracking-[0.2em] text-[var(--color-cozy-muted)] opacity-60">
                      BG
                    </span>
                    <span className="font-mono-retro text-[14px] text-[var(--color-cozy-muted)] tracking-wide font-normal opacity-75">
                      {bgCompleted}/{bgTotal}
                    </span>
                  </div>
                )}

                {spriteTotal > 0 && (
                  <div className="flex flex-col items-center gap-1">
                    <span className="font-mono-retro text-[8px] uppercase tracking-[0.2em] text-[var(--color-cozy-muted)] opacity-60">
                      SPRITE
                    </span>
                    <span className="font-mono-retro text-[14px] text-[var(--color-cozy-muted)] tracking-wide font-normal opacity-75">
                      {spriteCompleted}/{spriteTotal}
                    </span>
                  </div>
                )}

                {cgTotal > 0 && (
                  <div className="flex flex-col items-center gap-1">
                    <span className="font-mono-retro text-[8px] uppercase tracking-[0.2em] text-[var(--color-cozy-muted)] opacity-60">
                      CG
                    </span>
                    <span className="font-mono-retro text-[14px] text-[var(--color-cozy-muted)] tracking-wide font-normal opacity-75">
                      {cgCompleted}/{cgTotal}
                    </span>
                  </div>
                )}

                {voiceTotal > 0 && (
                  <div className="flex flex-col items-center gap-1">
                    <span className="font-mono-retro text-[8px] uppercase tracking-[0.2em] text-[var(--color-cozy-muted)] opacity-60">
                      VOICE
                    </span>
                    <span className="font-mono-retro text-[14px] text-[var(--color-cozy-muted)] tracking-wide font-normal opacity-75">
                      {voiceCompleted}/{voiceTotal}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* CSS 动画定义 */}
      <style>{`
        @keyframes coloredBounce {
          0%, 80%, 100% {
            transform: scale(0.7) translateY(0);
            opacity: 0.4;
          }
          40% {
            transform: scale(1.3) translateY(-16px);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
};
