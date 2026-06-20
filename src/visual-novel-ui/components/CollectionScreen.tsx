import React, { useCallback, useEffect, useState } from 'react';
import { Skull, Trash2, X } from './Icons';

interface EndingItem {
  标题: string;
  描述: string;
}

interface CollectionScreenProps {
  onClose: () => void;
  playSfx: () => void;
}

/** 从角色卡变量读取已解锁的结局列表 */
function loadEndingsFromCharVar(): EndingItem[] {
  try {
    const charVars = getVariables({ type: 'character' }) as Record<string, any>;
    const endings: EndingItem[] = charVars?.收集?.结局 ?? [];
    return Array.isArray(endings) ? endings : [];
  } catch (e) {
    console.warn('[CollectionScreen] 读取角色卡变量失败:', e);
    return [];
  }
}

/** 从角色卡变量中删除指定结局 */
function removeEndingFromCharVar(title: string): EndingItem[] {
  try {
    const charVars = getVariables({ type: 'character' }) as Record<string, any>;
    const endings: EndingItem[] = charVars?.收集?.结局 ?? [];
    const filtered = endings.filter(e => e.标题 !== title);
    replaceVariables({ ...charVars, 收集: { ...(charVars.收集 || {}), 结局: filtered } }, { type: 'character' });
    return filtered;
  } catch (e) {
    console.error('[CollectionScreen] 删除结局失败:', e);
    return [];
  }
}

export const CollectionScreen: React.FC<CollectionScreenProps> = ({ onClose, playSfx }) => {
  const [endings, setEndings] = useState<EndingItem[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    setEndings(loadEndingsFromCharVar());
  }, []);

  const handleDelete = useCallback(
    (title: string) => {
      playSfx();
      const updated = removeEndingFromCharVar(title);
      setEndings(updated);
      setConfirmDelete(null);
    },
    [playSfx],
  );

  return (
    <div className="game-modal absolute inset-0 z-50 cozy-overlay flex items-center justify-center p-4 md:p-6 animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl h-[90%] md:h-[85%] flex flex-col cozy-surface border-[color:var(--color-cozy-border-strong)] rounded-[28px] overflow-hidden">
        {/* 背景光晕 */}
        <div className="absolute top-[-10%] right-[-5%] w-[40%] h-[40%] bg-[radial-gradient(ellipse_at_top_right,rgba(221,184,176,0.15),transparent_70%)] pointer-events-none" />

        {/* 顶部标题栏 */}
        <div className="relative flex items-center justify-between px-8 pt-8 pb-5 border-b border-[color:rgba(161,132,117,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.4),transparent)] z-10 shrink-0">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <span className="w-1.5 h-1.5 bg-[var(--color-cozy-accent)] rounded-full animate-pulse" />
              <h2 className="font-serif-sc text-xl text-[var(--color-cozy-ink)] tracking-[0.1em] font-bold">收藏馆</h2>
            </div>
            <span className="font-mono-retro text-[9px] text-[var(--color-cozy-muted)] tracking-[0.4em] uppercase ml-4.5">
              archive_nexus
            </span>
          </div>
          <button
            onClick={() => {
              playSfx();
              onClose();
            }}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.18)] text-[var(--color-cozy-muted)] hover:text-[var(--color-cozy-ink)] hover:bg-[rgba(255,255,255,0.8)] transition-all duration-300 cursor-pointer shadow-[0_4px_12px_rgba(109,88,76,0.08)] group"
          >
            <X size={16} className="group-hover:rotate-90 transition-transform duration-300" />
          </button>
        </div>

        {/* Tab 区域（目前只有结局，预留扩展） */}
        <div className="px-8 pt-5 pb-0 flex items-center gap-6 border-b border-[color:rgba(161,132,117,0.12)] bg-[rgba(255,255,255,0.2)] shrink-0">
          <button className="flex flex-col items-start gap-1 group cursor-pointer relative pb-3">
            <span className="font-mono-retro text-[11px] tracking-[0.25em] uppercase text-[var(--color-cozy-ink)] transition-colors font-bold">
              ENDINGS
            </span>
            <div className="absolute bottom-0 left-0 w-full h-[2px] bg-[var(--color-cozy-ink)]" />
          </button>
          <button className="flex flex-col items-start gap-1 group cursor-pointer relative pb-3 opacity-50 hover:opacity-80 transition-opacity">
            <span className="font-mono-retro text-[11px] tracking-[0.25em] uppercase text-[var(--color-cozy-muted)]">
              [LOCKED]
            </span>
            <div className="absolute bottom-0 left-0 w-0 h-[2px] bg-[var(--color-cozy-muted)] transition-all group-hover:w-full" />
          </button>
        </div>

        {/* 结局列表 (网格布局) */}
        <div className="flex-1 overflow-y-auto px-8 py-6 cozy-scrollbar relative z-10">
          {endings.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-[var(--color-cozy-muted)] opacity-60">
              <Skull size={36} className="opacity-50 mb-2" strokeWidth={1.5} />
              <p className="font-mono-retro text-xs tracking-[0.3em] uppercase">EMPTY_ARCHIVE</p>
              <p className="font-serif-sc text-[13px] tracking-wider">尚未解锁任何记忆残片</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 auto-rows-max">
              {endings.map((ending, idx) => (
                <div
                  key={`${ending.标题}_${idx}`}
                  className="group relative cozy-list-item rounded-[16px] overflow-hidden"
                  style={{
                    animation: `fade-in 0.5s ease-out forwards`,
                    animationDelay: `${idx * 100}ms`,
                    opacity: 0,
                  }}
                >
                  {/* 装饰层 */}
                  <div className="absolute inset-0 bg-gradient-to-br from-[rgba(255,255,255,0.4)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                  <div className="p-5 flex flex-col h-full relative z-10">
                    <div className="flex items-start justify-between mb-4">
                      {/* 编号 + 标题 */}
                      <div className="flex flex-col gap-1.5 min-w-0 pr-4">
                        <div className="flex items-center gap-2 text-[var(--color-cozy-muted)] opacity-80 group-hover:opacity-100 transition-opacity">
                          <Skull size={12} strokeWidth={2} />
                          <span className="font-mono-retro text-[10px] tracking-widest font-bold">
                            NO.{String(idx + 1).padStart(3, '0')}
                          </span>
                        </div>
                        <span className="font-serif-sc text-lg text-[var(--color-cozy-ink)] transition-colors tracking-wide font-bold truncate">
                          {ending.标题}
                        </span>
                      </div>

                      {/* 删除按钮 */}
                      {confirmDelete === ending.标题 ? (
                        <div className="flex items-center gap-1.5 shrink-0 bg-[rgba(188,74,60,0.1)] p-1 rounded-[8px] border border-[rgba(188,74,60,0.2)]">
                          <button
                            onClick={() => handleDelete(ending.标题)}
                            className="px-2 py-1 text-[9px] font-mono-retro tracking-widest text-[#a44840] hover:bg-[#a44840] hover:text-white transition-colors cursor-pointer rounded-[4px] font-bold"
                          >
                            CONFIRM
                          </button>
                          <button
                            onClick={() => {
                              playSfx();
                              setConfirmDelete(null);
                            }}
                            className="px-2 py-1 text-[9px] font-mono-retro tracking-widest text-[var(--color-cozy-muted)] hover:bg-[rgba(255,255,255,0.4)] hover:text-[var(--color-cozy-ink)] transition-colors cursor-pointer rounded-[4px]"
                          >
                            CANCEL
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            playSfx();
                            setConfirmDelete(ending.标题);
                          }}
                          className="w-8 h-8 shrink-0 flex items-center justify-center rounded-[8px] cozy-button-danger opacity-0 group-hover:opacity-100 transition-all duration-300 cursor-pointer"
                          title="DELETE_ARCHIVE"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>

                    {/* 描述 */}
                    {ending.描述 && (
                      <p className="font-serif-sc text-[13px] text-[var(--color-cozy-ink)] opacity-80 leading-relaxed mt-auto border-t border-[color:rgba(161,132,117,0.12)] pt-3 line-clamp-3">
                        {ending.描述}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部阅读渐变遮罩 */}
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[rgba(245,236,228,0.95)] to-transparent pointer-events-none z-20" />

        {/* 底部统计与装饰 */}
        <div className="relative z-10 px-8 py-4 border-t border-[color:rgba(161,132,117,0.16)] bg-[rgba(255,255,255,0.3)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-mono-retro text-[9px] text-[var(--color-cozy-muted)] tracking-[0.2em] uppercase opacity-80">
              ARCHIVES_RESTORED
            </span>
            <span className="font-mono-retro text-sm text-[var(--color-cozy-ink)] tracking-widest font-bold">
              {endings.length}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
