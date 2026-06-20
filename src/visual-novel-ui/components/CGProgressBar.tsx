import React, { useEffect, useState } from 'react';
import type { CGTaskProgress } from '../types';
import { AlertCircle, CheckCircle2, Loader2, Sparkles } from './Icons';

interface CGProgressBarProps {
  progress: CGTaskProgress;
}

/**
 * CG 生成进度浮层
 * 显示在对话框上方，半透明背景，不遮挡主要内容
 */
export const CGProgressBar: React.FC<CGProgressBarProps> = ({ progress }) => {
  const [visible, setVisible] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    if (progress.status === 'idle') {
      setVisible(false);
      setFadeOut(false);
      return;
    }

    if (progress.status === 'done') {
      // done 状态显示 2 秒后淡出
      setVisible(true);
      setFadeOut(false);
      const timer = setTimeout(() => {
        setFadeOut(true);
        const hideTimer = setTimeout(() => setVisible(false), 300);
        return () => clearTimeout(hideTimer);
      }, 2000);
      return () => clearTimeout(timer);
    }

    // analyzing / generating / error 都显示
    setVisible(true);
    setFadeOut(false);
  }, [progress.status, progress.completed]);

  if (!visible) return null;

  return (
    <div
      className={`absolute top-2 left-1/2 -translate-x-1/2 z-[50] transition-all duration-300 ${
        fadeOut ? 'opacity-0 translate-y-[-4px]' : 'opacity-100 translate-y-0'
      }`}
    >
      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/60 backdrop-blur-md border border-white/10 shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
        {progress.status === 'analyzing' && (
          <>
            <Sparkles size={13} className="text-amber-300 animate-pulse" />
            <span className="text-[11px] font-mono-retro text-white/80 tracking-wider">提示词生成中...</span>
          </>
        )}

        {progress.status === 'generating' && (
          <>
            <Loader2 size={13} className="text-sky-300 animate-spin" />
            <span className="text-[11px] font-mono-retro text-white/80 tracking-wider">
              CG 生成中 ({progress.completed ?? 0}/{progress.total ?? '?'})
            </span>
            {/* 进度条 */}
            {progress.total && progress.total > 0 && (
              <div className="w-16 h-1 rounded-full bg-white/10 overflow-hidden ml-1">
                <div
                  className="h-full bg-sky-400 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${((progress.completed ?? 0) / progress.total) * 100}%` }}
                />
              </div>
            )}
          </>
        )}

        {progress.status === 'done' && (
          <>
            <CheckCircle2 size={13} className="text-emerald-400" />
            <span className="text-[11px] font-mono-retro text-white/80 tracking-wider">
              生成完成 {progress.completed}/{progress.total}
            </span>
          </>
        )}

        {progress.status === 'error' && (
          <>
            <AlertCircle size={13} className="text-red-400" />
            <span className="text-[11px] font-mono-retro text-red-300/90 tracking-wider max-w-[200px] truncate">
              {progress.error || '生成失败'}
            </span>
          </>
        )}
      </div>
    </div>
  );
};
