import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { SkitLine } from '../types';
import { RotateCcw } from './Icons';

interface SkitPlayerProps {
  lines: SkitLine[];
}

/** 每条气泡的显示间隔（ms�?*/
const BUBBLE_INTERVAL = 2200;
/** 最多同时可见的气泡�?*/
const MAX_VISIBLE = 4;

export const SkitPlayer: React.FC<SkitPlayerProps> = ({ lines }) => {
  // 当前已显示到第几条（-1 表示尚未开始）
  const [visibleCount, setVisibleCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playKey, setPlayKey] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isFinished = visibleCount >= lines.length;

  // 逐条播放
  useEffect(() => {
    if (lines.length === 0) return;
    setVisibleCount(1); // 立即显示第一�?
    let count = 1;
    const tick = () => {
      count++;
      if (count <= lines.length) {
        setVisibleCount(count);
        timerRef.current = setTimeout(tick, BUBBLE_INTERVAL);
      }
    };
    timerRef.current = setTimeout(tick, BUBBLE_INTERVAL);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [lines, playKey]);

  // 新气泡出现时自动滚动到底部
  useEffect(() => {
    if (visibleCount > 0 && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [visibleCount]);

  // 重播
  const handleReplay = useCallback(() => {
    setVisibleCount(0);
    setPlayKey(k => k + 1);
  }, []);

  if (lines.length === 0) return null;

  // 计算可见范围：最多显�?MAX_VISIBLE 条，旧的淡出
  const startIdx = Math.max(0, visibleCount - MAX_VISIBLE);

  return (
    <div className="mt-6 w-full max-w-sm mx-auto flex flex-col items-center gap-0.5">
      {/* 分隔�?*/}
      <div className="w-16 h-[1px] bg-stone-700/30 mb-3" />

      {/* 气泡区域 */}
      <div className="w-full flex flex-col gap-2.5 min-h-[60px]">
        {lines.slice(0, visibleCount).map((line, idx) => {
          const isOld = idx < startIdx;
          // 交替左右排列
          const isLeft = idx % 2 === 0;

          return (
            <div
              key={`${playKey}-${idx}`}
              className={`
                flex flex-col gap-0.5 transition-all duration-500 ease-out
                ${isOld ? 'opacity-0 -translate-y-2 h-0 overflow-hidden' : 'opacity-100 translate-y-0'}
                ${isLeft ? 'items-start' : 'items-end'}
              `}
              style={{
                animation: isOld ? undefined : `skitBubbleIn 0.4s ease-out`,
              }}
            >
              {/* 角色�?*/}
              <span className="font-mono-retro text-[10px] text-stone-600 tracking-wider px-1">{line.speaker}</span>
              {/* 气泡 */}
              <div
                className={`
                  px-3.5 py-2 max-w-[85%]
                  border border-stone-700/25
                  rounded-sm
                `}
              >
                <span className="font-serif-sc text-sm text-stone-400 leading-relaxed">{line.text}</span>
              </div>
            </div>
          );
        })}
        {/* 滚动锚点 */}
        <div ref={bottomRef} />
      </div>

      {/* 重播按钮 �?播放完毕后显�?*/}
      {isFinished && (
        <button
          onClick={handleReplay}
          className="mt-3 flex items-center gap-1.5 px-3 py-1
            text-stone-600 hover:text-stone-400
            font-mono-retro text-[10px] tracking-wider
            transition-all duration-200 cursor-pointer
            opacity-0 animate-[skitFadeIn_0.4s_ease-out_0.3s_forwards]"
        >
          <RotateCcw size={10} />
          <span>REPLAY</span>
        </button>
      )}

      {/* 动画 keyframes */}
      <style>{`
        @keyframes skitBubbleIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes skitFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
};
