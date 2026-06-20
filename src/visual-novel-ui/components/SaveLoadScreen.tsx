import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseDialogueScript } from '../parser';
import { AlertTriangle, FolderOpen, Search, Trash2, X } from './Icons';

// ====== 类型 ======

interface SaveLoadEntry {
  messageId: number;
  sceneName: string;
  speaker: string;
  preview: string;
}

interface SaveLoadScreenProps {
  onClose: () => void;
  onLoadMessage: (messageId: number) => void;
  onDeleteFromMessage: (messageId: number) => Promise<void>;
  currentMessageId: number | null;
  playSfx: () => void;
}

// ====== 常量 ======

const ITEM_HEIGHT = 72; // 每条档位的固定高度（px）
const OVERSCAN = 4; // 上下各多渲染几条，避免滚动白闪

// ====== 虚拟滚动 Hook ======

function useVirtualScroll(itemCount: number, itemHeight: number, containerRef: React.RefObject<HTMLDivElement | null>) {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    setContainerHeight(el.clientHeight);

    return () => observer.disconnect();
  }, [containerRef]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const totalHeight = itemCount * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - OVERSCAN);
  const endIndex = Math.min(itemCount - 1, Math.ceil((scrollTop + containerHeight) / itemHeight) + OVERSCAN);
  const offsetY = startIndex * itemHeight;

  return { totalHeight, startIndex, endIndex, offsetY, handleScroll };
}

// ====== 主组件 ======

export const SaveLoadScreen: React.FC<SaveLoadScreenProps> = ({
  onClose,
  onLoadMessage,
  onDeleteFromMessage,
  currentMessageId,
  playSfx,
}) => {
  useEffect(() => {
    playSfx();
  }, []);

  // ====== 数据加载 ======
  const [entries, setEntries] = useState<SaveLoadEntry[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadEntries = useCallback(() => {
    try {
      const lastId = getLastMessageId();
      const messages = getChatMessages(`0-${lastId}`, { role: 'assistant' });
      const result = messages.map(msg => {
        const parsed = parseDialogueScript(msg.message);
        const segments = parsed.segments;
        let sceneName = '';
        for (const seg of segments) {
          if (seg.effects.bg) sceneName = seg.effects.bg;
        }
        const firstSeg = segments[0];
        const speaker = firstSeg?.speaker || '—';
        const preview = firstSeg?.text || '';
        return {
          messageId: msg.message_id,
          sceneName: sceneName || '未知场景',
          speaker,
          preview: preview.length > 50 ? preview.slice(0, 50) + '…' : preview || '(空)',
        };
      });
      // 倒序：最新在上
      setEntries(result.reverse());
    } catch (e) {
      console.warn('[SaveLoadScreen] 加载楼层列表失败:', e);
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries, refreshKey]);

  // ====== 范围筛选 ======
  const [rangeInput, setRangeInput] = useState('');
  const [isRangeActive, setIsRangeActive] = useState(false);

  const filteredEntries = useMemo(() => {
    if (!isRangeActive || !rangeInput.trim()) return entries;

    const match = rangeInput.trim().match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if (!match) return entries;

    const from = parseInt(match[1], 10);
    const to = parseInt(match[2], 10);
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);

    return entries.filter(e => e.messageId >= lo && e.messageId <= hi);
  }, [entries, rangeInput, isRangeActive]);

  const handleRangeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      setIsRangeActive(true);
    } else if (e.key === 'Escape') {
      setRangeInput('');
      setIsRangeActive(false);
    }
  };

  const clearRange = () => {
    setRangeInput('');
    setIsRangeActive(false);
  };

  // ====== 虚拟滚动 ======
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { totalHeight, startIndex, endIndex, offsetY, handleScroll } = useVirtualScroll(
    filteredEntries.length,
    ITEM_HEIGHT,
    scrollContainerRef,
  );

  const visibleEntries = filteredEntries.slice(startIndex, endIndex + 1);

  // ====== 删除确认弹窗 ======
  const [deleteTarget, setDeleteTarget] = useState<SaveLoadEntry | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteClick = (e: React.MouseEvent, entry: SaveLoadEntry) => {
    e.stopPropagation();
    playSfx();
    setDeleteTarget(entry);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await onDeleteFromMessage(deleteTarget.messageId);
      setDeleteTarget(null);
      // 刷新列表
      setRefreshKey(k => k + 1);
    } catch (e) {
      console.error('[SaveLoadScreen] 删除失败:', e);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancelDelete = () => {
    playSfx();
    setDeleteTarget(null);
  };

  // 计算将被删除的楼层数
  const deleteCount = useMemo(() => {
    if (!deleteTarget) return 0;
    return entries.filter(e => e.messageId >= deleteTarget.messageId).length;
  }, [deleteTarget, entries]);

  const handleClose = () => {
    playSfx();
    onClose();
  };

  return (
    <div className="game-modal absolute inset-0 z-50 cozy-overlay flex flex-col items-center justify-center p-4 md:p-6 animate-in fade-in duration-200">
      <div className="max-w-4xl w-full h-[90%] md:h-[85%] flex flex-col cozy-surface border-[color:var(--color-cozy-border-strong)] rounded-[28px] relative overflow-hidden">
        {/* 背景光晕 */}
        <div className="absolute top-0 right-0 w-1/2 h-[200px] bg-[radial-gradient(ellipse_at_top_right,rgba(221,184,176,0.15),transparent_70%)] pointer-events-none" />

        {/* Header */}
        <div className="relative z-10 flex justify-between items-center px-8 max-md:portrait:px-3 py-5 max-md:portrait:py-2 border-b border-[color:rgba(161,132,117,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.4),transparent)] shrink-0 gap-2">
          <div className="flex items-center gap-4 max-md:portrait:gap-2 min-w-0 overflow-hidden">
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2 max-md:portrait:gap-1.5 min-w-0">
                <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-[var(--color-cozy-accent)] opacity-80" />
                <h2 className="font-serif-sc text-[17px] max-md:portrait:text-[13px] text-[var(--color-cozy-ink)] tracking-[0.1em] max-md:portrait:tracking-wide font-bold uppercase truncate">
                  存读
                </h2>
              </div>
              <span className="font-mono-retro text-[8px] text-[var(--color-cozy-muted)] tracking-[0.3em] uppercase ml-3.5 max-md:portrait:ml-3 truncate">
                found: {filteredEntries.length.toString().padStart(4, '0')}
                {isRangeActive ? ` / total: ${entries.length.toString().padStart(4, '0')}` : ''}
              </span>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 max-md:portrait:w-6 max-md:portrait:h-6 shrink-0 flex items-center justify-center bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.18)] rounded-full text-[var(--color-cozy-muted)] hover:text-[var(--color-cozy-ink)] hover:bg-[rgba(255,255,255,0.8)] shadow-[0_4px_12px_rgba(109,88,76,0.08)] transition-all duration-300 cursor-pointer group"
          >
            <X size={14} className="group-hover:rotate-90 transition-transform duration-300" />
          </button>
        </div>

        {/* 范围筛选栏 */}
        <div className="relative z-10 px-8 max-md:portrait:px-3 py-3 max-md:portrait:py-1.5 border-b border-[color:rgba(161,132,117,0.16)] bg-[rgba(255,255,255,0.3)] flex items-center gap-4 max-md:portrait:gap-1.5 min-w-0">
          <Search
            size={14}
            className="text-[var(--color-cozy-muted)] shrink-0 max-md:portrait:w-3 max-md:portrait:h-3 opacity-80"
          />
          <div className="flex items-center gap-3 max-md:portrait:gap-1 flex-1 relative group min-w-0">
            <span className="font-mono-retro text-[10px] max-md:portrait:text-[8px] text-[var(--color-cozy-muted)] opacity-80 tracking-[0.2em] max-md:portrait:tracking-tight shrink-0 transition-colors">
              FLT:
            </span>
            <input
              type="text"
              value={rangeInput}
              onChange={e => {
                setRangeInput(e.target.value);
                if (!e.target.value.trim()) setIsRangeActive(false);
              }}
              onKeyDown={handleRangeKeyDown}
              placeholder="e.g. 5-20"
              className="flex-1 min-w-0 bg-transparent border-b border-transparent group-hover:border-[color:rgba(161,132,117,0.3)] focus:border-[color:var(--color-cozy-border-strong)] outline-none font-mono-retro text-[13px] max-md:portrait:text-[11px] text-[var(--color-cozy-ink)] placeholder:text-[var(--color-cozy-muted)] placeholder:opacity-50 py-1 transition-colors"
            />
            {isRangeActive && (
              <button
                onClick={() => {
                  playSfx();
                  clearRange();
                }}
                className="absolute right-0 text-[var(--color-cozy-muted)] hover:text-[var(--color-cozy-ink)] bg-[rgba(161,132,117,0.1)] hover:bg-[rgba(161,132,117,0.2)] p-1 max-md:portrait:p-0.5 rounded-full transition-all cursor-pointer"
              >
                <X size={10} className="max-md:portrait:w-2 max-md:portrait:h-2" />
              </button>
            )}
          </div>
          <span className="font-mono-retro text-[9px] max-md:portrait:text-[7px] text-[var(--color-cozy-muted)] opacity-80 tracking-[0.2em] max-md:portrait:tracking-tight shrink-0 border border-[color:rgba(161,132,117,0.18)] px-2 max-md:portrait:px-1 py-0.5 rounded-[4px] bg-[rgba(255,255,255,0.4)]">
            ENT↵
          </span>
        </div>

        {/* Content — 虚拟滚动 */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto px-6 max-md:portrait:px-2 py-4 max-md:portrait:py-2 cozy-scrollbar relative z-10"
          onScroll={handleScroll}
        >
          {filteredEntries.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-[var(--color-cozy-muted)] opacity-60">
              <span className="font-mono-retro text-sm tracking-[0.3em] mb-2">
                {isRangeActive ? 'OUT_OF_RANGE' : 'NO_ARCHIVES'}
              </span>
              <span className="font-serif-sc text-xs tracking-widest">
                {isRangeActive ? '该范围内无系统记录' : '等待剧情节点创建'}
              </span>
            </div>
          )}

          {filteredEntries.length > 0 && (
            <div style={{ height: totalHeight, position: 'relative' }}>
              <div style={{ position: 'absolute', top: offsetY, left: 0, right: 0 }}>
                {visibleEntries.map((entry, vIdx) => {
                  const isCurrent = entry.messageId === currentMessageId;
                  const realIdx = startIndex + vIdx;
                  return (
                    <div key={entry.messageId} style={{ height: ITEM_HEIGHT }} className="flex items-stretch py-1.5">
                      <button
                        onClick={() => {
                          playSfx();
                          onLoadMessage(entry.messageId);
                        }}
                        className={`
                          group flex-1 min-w-0 text-left px-6 max-md:portrait:px-2 rounded-l-[12px] transition-all duration-300 cursor-pointer relative overflow-hidden flex items-center
                          ${isCurrent ? 'cozy-list-item-active' : 'cozy-list-item'}
                        `}
                        style={{
                          animationDelay: `${realIdx * 20}ms`,
                          animation:
                            realIdx < 20 ? 'archiveSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards' : 'none',
                          opacity: realIdx < 20 ? 0 : 1,
                        }}
                      >
                        {/* 左侧指示条发光效果 */}
                        <div
                          className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 transition-all duration-300 ease-out rounded-r-full
                          ${isCurrent ? 'bg-[var(--color-cozy-accent)] h-3/4 shadow-[0_0_8px_rgba(221,184,176,0.6)]' : 'bg-transparent h-0 group-hover:bg-[var(--color-cozy-accent-soft)] group-hover:h-1/2'}`}
                        />

                        {/* Hover背景光晕 */}
                        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.4),transparent)] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                        <div className="flex items-center gap-6 max-md:portrait:gap-1.5 h-full relative z-10 w-full">
                          {/* 编号大字排版 */}
                          <div className="shrink-0 w-12 max-md:portrait:w-5 text-center">
                            <span
                              className={`font-mono-retro text-[14px] max-md:portrait:text-[12px] font-bold tracking-widest max-md:portrait:tracking-normal transition-colors
                              ${isCurrent ? 'text-[var(--color-cozy-ink)]' : 'text-[var(--color-cozy-muted)] group-hover:text-[var(--color-cozy-ink)]'}`}
                            >
                              {String(entry.messageId).padStart(3, '0')}
                            </span>
                          </div>

                          <div className="w-px h-8 bg-[rgba(161,132,117,0.18)] group-hover:bg-[rgba(161,132,117,0.3)] transition-colors" />

                          {/* 内容 */}
                          <div className="flex-1 min-w-0 flex flex-col justify-center">
                            <div className="flex items-center gap-3 max-md:portrait:gap-1 mb-1 max-md:portrait:mb-0">
                              <span className="font-serif-sc text-[15px] max-md:portrait:text-[13px] text-[var(--color-cozy-ink)] opacity-90 group-hover:opacity-100 transition-colors truncate leading-tight min-w-0">
                                {entry.sceneName}
                              </span>
                              {isCurrent && (
                                <span className="font-mono-retro text-[9px] max-md:portrait:text-[7px] text-[var(--color-cozy-ink)] bg-[var(--color-cozy-accent-soft)] tracking-[0.2em] max-md:portrait:tracking-normal px-2 max-md:portrait:px-1 py-0.5 max-md:portrait:py-0 rounded-[4px] font-bold shrink-0 animate-pulse">
                                  CUR
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 max-md:portrait:gap-1 text-[var(--color-cozy-muted)] transition-colors min-w-0 overflow-hidden">
                              <span className="font-serif-sc text-[11px] max-md:portrait:text-[10px] opacity-80 shrink-0 leading-none truncate max-w-[30%]">
                                {entry.speaker}
                              </span>
                              <span className="text-[8px] max-md:portrait:scale-75 shrink-0 opacity-60">—</span>
                              <span className="font-serif-sc text-[12px] max-md:portrait:text-[11px] truncate leading-tight flex-1 opacity-80">
                                {entry.preview}
                              </span>
                            </div>
                          </div>

                          {/* 右侧图标 (竖屏隐藏节约空间) */}
                          <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-[var(--color-cozy-muted)] group-hover:text-[var(--color-cozy-ink)] -translate-x-2 group-hover:translate-x-0 max-md:portrait:hidden">
                            <FolderOpen size={16} />
                          </div>
                        </div>
                      </button>

                      {/* 删除按钮 — 半透明质感 */}
                      <button
                        onClick={e => handleDeleteClick(e, entry)}
                        title={`截断删除：#${entry.messageId} 及之后所有楼层`}
                        className="w-12 max-md:portrait:w-7 shrink-0 flex items-center justify-center rounded-r-[12px] cozy-button-danger border-l-0 shadow-[inset_1px_0_0_rgba(161,132,117,0.1)] cursor-pointer z-20"
                      >
                        <Trash2 size={14} className="hover:scale-110 transition-transform" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 底部渐变遮罩 */}
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[rgba(245,236,228,0.95)] to-transparent pointer-events-none z-20" />
      </div>

      {/* ====== 截断删除确认弹窗 (Cozy 风格) ====== */}
      {deleteTarget && (
        <div className="absolute inset-0 z-[200] cozy-overlay flex items-center justify-center animate-in fade-in duration-200">
          <div className="cozy-surface p-8 max-w-md w-full mx-4 rounded-[24px] shadow-[0_20px_40px_rgba(109,88,76,0.15)] relative overflow-hidden border-[color:rgba(188,74,60,0.3)]">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[rgba(188,74,60,0)] via-[rgba(188,74,60,0.8)] to-[rgba(188,74,60,0)]" />

            <div className="flex items-center gap-3 mb-4 text-[#a44840]">
              <AlertTriangle size={20} className="animate-pulse" />
              <h3 className="font-mono-retro text-sm tracking-[0.2em] font-bold">TRUNCATE_WARNING</h3>
            </div>

            <p className="font-serif-sc text-[var(--color-cozy-ink)] text-[15px] leading-relaxed mb-3">
              将清除自{' '}
              <span className="text-[#a44840] font-bold font-mono-retro">
                #{String(deleteTarget.messageId).padStart(3, '0')}
              </span>{' '}
              节点起的所有后续记录。
            </p>
            <p className="font-mono-retro text-[11px] text-[var(--color-cozy-muted)] tracking-wider mb-8">
              预计销毁数据区块: <span className="text-[var(--color-cozy-ink)] font-bold">{deleteCount}</span>{' '}
              个。此操作不可逆转。
            </p>

            <div className="flex gap-4 justify-end">
              <button
                onClick={handleCancelDelete}
                disabled={isDeleting}
                className="px-6 py-2 rounded-[12px] cozy-button-icon text-xs tracking-widest font-mono-retro disabled:opacity-50"
              >
                CANCEL
              </button>
              <button
                onClick={() => {
                  playSfx();
                  handleConfirmDelete();
                }}
                disabled={isDeleting}
                className="px-6 py-2 rounded-[12px] cozy-button-danger text-xs tracking-widest font-mono-retro disabled:opacity-50 relative overflow-hidden group font-bold"
              >
                <div className="absolute inset-0 bg-white/20 -translate-x-full group-hover:animate-[scan_1s_ease-out_infinite]" />
                <span className="relative z-10">{isDeleting ? 'PURGING...' : 'CONFIRM_PURGE'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 动画 */}
      <style>{`
        @keyframes archiveSlideIn {
          from { opacity: 0; transform: translateY(10px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
};
