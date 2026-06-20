import React, { useEffect } from 'react';
import { renderRichText } from '../parser';
import { DialogueSegment } from '../types';
import { CornerDownRight, X } from './Icons';

interface LogScreenProps {
  segments: DialogueSegment[];
  onClose: () => void;
  playSfx: () => void;
  onJumpToSegment?: (index: number) => void;
}

export const LogScreen: React.FC<LogScreenProps> = ({ segments, onClose, playSfx, onJumpToSegment }) => {
  useEffect(() => {
    playSfx();
  }, []);

  const handleClose = () => {
    playSfx();
    onClose();
  };

  return (
    <div className="game-modal absolute inset-0 z-50 flex items-center justify-center p-4 cozy-overlay animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl h-[90%] md:h-[85%] cozy-surface flex flex-col overflow-hidden rounded-[28px] border-[color:var(--color-cozy-border-strong)]">
        {/* 背景光晕 */}
        <div className="absolute top-0 right-0 w-1/2 h-[200px] bg-[radial-gradient(ellipse_at_top_right,rgba(221,184,176,0.15),transparent_70%)] pointer-events-none" />

        {/* Header */}
        <div className="relative z-10 flex justify-between items-center px-8 py-5 border-b border-[color:rgba(161,132,117,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.4),transparent)] shrink-0">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-cozy-accent)] opacity-80" />
                <h2 className="font-serif-sc text-[17px] text-[var(--color-cozy-ink)] tracking-[0.1em] font-bold">
                  记录
                </h2>
              </div>
              <span className="font-mono-retro text-[8px] text-[var(--color-cozy-muted)] tracking-[0.3em] uppercase ml-3.5">
                entries: {segments.length.toString().padStart(4, '0')}
              </span>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.18)] rounded-full text-[var(--color-cozy-muted)] hover:text-[var(--color-cozy-ink)] hover:bg-[rgba(255,255,255,0.8)] shadow-[0_4px_12px_rgba(109,88,76,0.08)] transition-all duration-300 cursor-pointer group"
          >
            <X size={14} className="group-hover:rotate-90 transition-transform duration-300" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-8 py-6 cozy-scrollbar relative z-10">
          {segments.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-[var(--color-cozy-muted)] opacity-60">
              <span className="font-mono-retro text-sm tracking-[0.3em] mb-2">NO_RECORDS</span>
              <span className="font-serif-sc text-xs tracking-widest">暂无对话记录</span>
            </div>
          )}

          <div className="relative mx-auto max-w-3xl">
            {/* 时间线竖线 (高级细线) */}
            {segments.length > 0 && (
              <div className="absolute left-[5px] top-6 bottom-4 w-px bg-gradient-to-b from-transparent via-[rgba(161,132,117,0.22)] to-transparent" />
            )}

            <div className="space-y-4">
              {segments.map((segment, index) => (
                <div
                  key={segment.id}
                  className="group relative pl-8 py-3 rounded-lg hover:bg-[rgba(255,252,248,0.5)] border border-transparent hover:border-[color:rgba(161,132,117,0.14)] transition-all duration-300 cursor-default"
                >
                  {/* 时间线发光圆点 */}
                  <div className="absolute left-[3px] top-5 w-[5px] h-[5px] rounded-full bg-[rgba(161,132,117,0.4)] border border-[color:rgba(255,250,246,0.8)] group-hover:bg-[var(--color-cozy-accent)] group-hover:shadow-[0_0_8px_rgba(221,184,176,0.6)] group-hover:border-transparent transition-all duration-300" />

                  {/* 说话人与索引 */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-serif-sc font-medium text-sm text-[var(--color-cozy-ink)] opacity-80 group-hover:opacity-100 transition-opacity">
                      {segment.speaker}
                    </span>
                    <span className="font-mono-retro text-[9px] text-[var(--color-cozy-muted)] opacity-60 group-hover:opacity-100 tracking-[0.2em] transition-opacity">
                      MSG_#{String(index + 1).padStart(3, '0')}
                    </span>
                  </div>

                  {/* 内容 */}
                  <div className="flex items-start gap-4">
                    <p
                      className={`flex-1 font-serif-sc text-[15px] leading-[1.8] opacity-90 group-hover:opacity-100 transition-opacity ${segment.isInnerMonologue ? 'italic text-[var(--color-cozy-muted)]' : 'text-[var(--color-cozy-ink)]'}`}
                      dangerouslySetInnerHTML={{ __html: renderRichText(segment.text) }}
                    />
                    {onJumpToSegment && (
                      <button
                        onClick={() => {
                          playSfx();
                          onJumpToSegment(index);
                        }}
                        className="shrink-0 mt-1 p-2 rounded-full text-[var(--color-cozy-muted)] hover:text-[var(--color-cozy-ink)] hover:bg-[rgba(255,255,255,0.6)] opacity-0 group-hover:opacity-100 transition-all duration-300 cursor-pointer shadow-[0_0_10px_transparent] hover:shadow-[0_4px_12px_rgba(109,88,76,0.1)] -translate-x-2 group-hover:translate-x-0"
                        title="JUMP_TO_ENTRY"
                      >
                        <CornerDownRight size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 底部阅读渐变遮罩 */}
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[rgba(245,236,228,0.95)] to-transparent pointer-events-none z-20" />
      </div>
    </div>
  );
};
