import React, { useCallback, useEffect, useState } from 'react';
import type { CharacterCaption } from '../types';
import { Download, Edit2, RefreshCw, X } from './Icons';

interface CGViewerProps {
  /** CG 图片 base64 data URL */
  imageBase64: string;
  /** 关闭回调 */
  onClose: () => void;
  /** 下载文件名（不含扩展名） */
  fileName?: string;
  /** 生成 CG 用的 prompt（用于重新生成） */
  prompt?: string;
  /** 角色外貌和位置信息（用于重新生成） */
  characters?: CharacterCaption[];
  /** 楼层 ID */
  messageId?: number;
  /** 段落索引 */
  paragraphIndex?: number;
  /** 图片更新回调（新 base64 和新 seed） */
  onImageUpdated?: (newBase64: string, newSeed: number) => void;
  /** 初始种子 */
  seed?: number;
  /** 基础提示词（用于编辑） */
  basePrompt?: string;
  /** 负面提示词（用于编辑） */
  negativePrompt?: string;
}

/**
 * CG 沉浸全屏查看器
 * 支持重新生成（再来一张）和多版本选择
 */
export const CGViewer: React.FC<CGViewerProps> = ({
  imageBase64,
  onClose,
  fileName = 'cg_image',
  prompt,
  characters,
  messageId,
  paragraphIndex,
  onImageUpdated,
  seed,
  basePrompt,
  negativePrompt,
}) => {
  // 版本历史：当前 base64 是初始版本
  const [versions, setVersions] = useState<string[]>([imageBase64]);
  const [versionSeeds, setVersionSeeds] = useState<number[]>([seed || 0]); // 每个版本对应的种子
  const [currentVersionIndex, setCurrentVersionIndex] = useState(0);
  const [isRegenerating, setIsRegenerating] = useState(false);
  
  // 编辑面板状态
  const [isEditPanelOpen, setIsEditPanelOpen] = useState(false);
  const [editedBasePrompt, setEditedBasePrompt] = useState(basePrompt || prompt || '');
  const [editedNegativePrompt, setEditedNegativePrompt] = useState(negativePrompt || '');
  const [editedCharacters, setEditedCharacters] = useState<CharacterCaption[]>(characters || []);
  const [editedSeed, setEditedSeed] = useState<number>(seed || 0);
  const [isSeedEditable, setIsSeedEditable] = useState(false); // 种子是否可编辑

  // 当切换版本时，更新编辑面板中的种子值
  useEffect(() => {
    setEditedSeed(versionSeeds[currentVersionIndex] || 0);
  }, [currentVersionIndex, versionSeeds]);

  // 当外部 imageBase64 变化时更新版本列表
  useEffect(() => {
    setVersions(prev => {
      if (prev[prev.length - 1] !== imageBase64) {
        return [...prev, imageBase64];
      }
      return prev;
    });
  }, [imageBase64]);

  const handleDownload = useCallback(() => {
    const currentImage = versions[currentVersionIndex];
    let ext = 'png';
    if (currentImage.includes('image/webp')) ext = 'webp';
    else if (currentImage.includes('image/jpeg')) ext = 'jpg';

    // 移动端兼容：使用 fetch + blob 方式下载
    fetch(currentImage)
      .then(res => res.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${fileName}.${ext}`;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();

        // 清理
        setTimeout(() => {
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }, 100);
      })
      .catch(err => {
        console.error('[CGViewer] 下载失败:', err);
        // 降级方案：在新标签页打开图片
        const win = window.open();
        if (win) {
          win.document.write(`<img src="${currentImage}" alt="CG" style="max-width:100%;height:auto;" />`);
        }
      });
  }, [versions, currentVersionIndex, fileName]);

  // 处理关闭：保留当前选择的版本
  const handleClose = useCallback(() => {
    if (onImageUpdated && versions.length > 1) {
      const selectedImage = versions[currentVersionIndex];
      onImageUpdated(selectedImage, 0); // seed传0表示这是选择操作
    }
    onClose();
  }, [onClose, onImageUpdated, versions, currentVersionIndex]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        handleClose();
      }
    },
    [handleClose],
  );

  // 重新生成（调用 NovelAI API，使用相同 prompt 不同 seed）
  const handleRegenerate = useCallback(async () => {
    if (!prompt || isRegenerating) return;
    setIsRegenerating(true);

    try {
      const { generateImage } = await import('../services/novelAI');
      const { loadCGSettings } = await import('../services/cgTaskManager');
      const { getActiveVibesWithImages } = await import('../services/vibeManager');
      const config = loadCGSettings().novelAI;
      const vibes = await getActiveVibesWithImages();
      const newSeed = Math.floor(Math.random() * 2147483647);
      const result = await generateImage(prompt, config, newSeed, vibes, undefined, characters);
      const newBase64 = result.base64;

      setVersions(prev => [...prev, newBase64]);
      setVersionSeeds(prev => [...prev, newSeed]); // 记录新版本的种子
      const newIndex = versions.length;
      setCurrentVersionIndex(newIndex);

      // 通知父组件更新
      if (onImageUpdated) {
        onImageUpdated(newBase64, newSeed);
      }
    } catch (e) {
      console.error('[CGViewer] 重新生成失败:', e);
      const errorMsg = e instanceof Error ? e.message : String(e);
      
      // 使用 toastr 提供更好的用户体验（如果可用）
      if (typeof toastr !== 'undefined') {
        toastr.error(`重新生成失败: ${errorMsg}`, '生图错误', { timeOut: 5000 });
      } else {
        alert(`重新生成失败: ${errorMsg}\n\n请检查 NovelAI 配置和网络连接`);
      }
    } finally {
      setIsRegenerating(false);
    }
  }, [prompt, isRegenerating, versions.length, onImageUpdated, characters]);

  // 打开编辑面板
  const handleOpenEdit = useCallback(() => {
    setIsSeedEditable(false); // 重置种子编辑状态
    setIsEditPanelOpen(true);
  }, []);

  // 关闭编辑面板
  const handleCloseEdit = useCallback(() => {
    setIsEditPanelOpen(false);
  }, []);

  // 使用编辑后的参数重新生成
  const handleRegenerateWithEdits = useCallback(async () => {
    if (isRegenerating) return;
    setIsRegenerating(true);
    setIsEditPanelOpen(false);

    try {
      const { generateImage } = await import('../services/novelAI');
      const { loadCGSettings } = await import('../services/cgTaskManager');
      const { getActiveVibesWithImages } = await import('../services/vibeManager');
      const config = loadCGSettings().novelAI;
      const vibes = await getActiveVibesWithImages();
      
      // 如果没有编辑种子，使用随机种子；否则使用编辑的种子
      const finalSeed = isSeedEditable ? editedSeed : Math.floor(Math.random() * 2147483647);
      
      const result = await generateImage(
        editedBasePrompt,
        config,
        finalSeed,
        vibes,
        undefined,
        editedCharacters.filter(c => !c.disabled)
      );
      const newBase64 = result.base64;

      setVersions(prev => [...prev, newBase64]);
      setVersionSeeds(prev => [...prev, finalSeed]); // 记录新版本的种子
      const newIndex = versions.length;
      setCurrentVersionIndex(newIndex);

      if (onImageUpdated) {
        onImageUpdated(newBase64, finalSeed);
      }
    } catch (e) {
      console.error('[CGViewer] 使用编辑参数生成失败:', e);
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (typeof toastr !== 'undefined') {
        toastr.error(`生成失败: ${errorMsg}`, '生图错误', { timeOut: 5000 });
      } else {
        alert(`生成失败: ${errorMsg}`);
      }
    } finally {
      setIsRegenerating(false);
    }
  }, [isRegenerating, editedBasePrompt, editedSeed, editedCharacters, versions.length, onImageUpdated, isSeedEditable]);

  const currentImage = versions[currentVersionIndex];

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col animate-in fade-in duration-300 cursor-pointer"
      onClick={handleBackdropClick}
    >
      {/* 图片区域 - 使用 key 触发渐变动画 */}
      <div className="flex-1 flex items-center justify-center relative">
        <img
          key={currentVersionIndex}
          src={currentImage}
          alt="CG"
          className="max-w-[90vw] max-h-[80vh] object-contain cursor-default select-none animate-in fade-in duration-500"
          draggable={false}
        />
      </div>

      {/* 右上角按钮组 */}
      <div className="absolute top-6 right-6 flex items-center gap-3">
        {/* 编辑参数按钮 */}
        {prompt && (
          <button
            onClick={e => {
              e.stopPropagation();
              handleOpenEdit();
            }}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 border border-white/20 text-white/70 hover:text-white hover:bg-white/20 transition-all duration-300 cursor-pointer backdrop-blur-sm"
            title="编辑参数"
          >
            <Edit2 size={18} />
          </button>
        )}
        
        {/* 重新生成按钮 */}
        {prompt && (
          <button
            onClick={e => { e.stopPropagation(); handleRegenerate(); }}
            disabled={isRegenerating}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 border border-white/20 text-white/70 hover:text-white hover:bg-white/20 transition-all duration-300 cursor-pointer backdrop-blur-sm disabled:opacity-50"
            title="再来一张"
          >
            <RefreshCw size={18} className={isRegenerating ? 'animate-spin' : ''} />
          </button>
        )}

        {/* 下载按钮 */}
        <button
          onClick={e => { e.stopPropagation(); handleDownload(); }}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 border border-white/20 text-white/70 hover:text-white hover:bg-white/20 transition-all duration-300 cursor-pointer backdrop-blur-sm"
          title="下载 CG"
        >
          <Download size={18} />
        </button>

        {/* 关闭按钮 */}
        <button onClick={e => { e.stopPropagation(); handleClose(); }} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 border border-white/20 text-white/70 hover:text-white hover:bg-white/20 transition-all duration-300 cursor-pointer backdrop-blur-sm"
          title="关闭"
        >
          <X size={18} />
        </button>
      </div>

      {/* 底部版本选择器（多版本时显示） */}
      {versions.length > 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full bg-black/50 backdrop-blur-sm border border-white/10">
          {versions.map((ver, idx) => (
            <button
              key={idx}
              onClick={e => {
                e.stopPropagation();
                setCurrentVersionIndex(idx);
              }}
              className={`w-8 h-8 rounded-lg bg-cover bg-center transition-all duration-200 cursor-pointer border-2 flex-shrink-0 ${
                idx === currentVersionIndex
                  ? 'border-white scale-110'
                  : 'border-transparent opacity-60 hover:opacity-80'
              }`}
              style={{ backgroundImage: `url(${ver})` }}
              title={`版本 ${idx + 1}`}
            />
          ))}
        </div>
      )}

      {/* 版本提示（当前版本/总数） */}
      {versions.length > 1 && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 font-mono-retro text-[10px] text-white/50 tracking-[0.2em]">
          {currentVersionIndex + 1} / {versions.length}
        </div>
      )}

      {/* 编辑面板 */}
      {isEditPanelOpen && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-10 animate-in fade-in duration-200">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-lg w-[90vw] max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h3 className="text-white/90 font-mono-retro text-sm tracking-wider">编辑生图参数</h3>
              <button onClick={handleCloseEdit} className="text-white/50 hover:text-white/80 transition-colors">
                <X size={20} />
              </button>
            </div>

            {/* 内容区域 */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* 基础提示词 */}
              <div>
                <label className="block text-white/70 text-xs mb-2 font-mono-retro tracking-wide">基础提示词</label>
                <textarea
                  value={editedBasePrompt}
                  onChange={e => setEditedBasePrompt(e.target.value)}
                  className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-white/90 text-sm font-mono resize-none focus:border-white/30 focus:outline-none transition-colors"
                  rows={4}
                  placeholder="输入 Danbooru tags..."
                />
              </div>

              {/* 负面提示词 */}
              <div>
                <label className="block text-white/70 text-xs mb-2 font-mono-retro tracking-wide">负面提示词</label>
                <textarea
                  value={editedNegativePrompt}
                  onChange={e => setEditedNegativePrompt(e.target.value)}
                  className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-white/90 text-sm font-mono resize-none focus:border-white/30 focus:outline-none transition-colors"
                  rows={3}
                  placeholder="输入负面 tags..."
                />
              </div>

              {/* 种子 */}
              <div>
                <label className="block text-white/70 text-xs mb-2 font-mono-retro tracking-wide">种子（Seed）</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={editedSeed}
                    onChange={e => setEditedSeed(parseInt(e.target.value) || 0)}
                    disabled={!isSeedEditable}
                    className="flex-1 bg-black/30 border border-white/10 rounded px-3 py-2 text-white/90 text-sm font-mono focus:border-white/30 focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    placeholder="当前图片种子"
                  />
                  <button
                    onClick={() => setIsSeedEditable(!isSeedEditable)}
                    className={`w-10 h-10 flex items-center justify-center rounded border transition-colors ${
                      isSeedEditable
                        ? 'bg-white/20 border-white/30 text-white/90'
                        : 'bg-white/5 border-white/10 text-white/50 hover:text-white/80 hover:bg-white/10'
                    }`}
                    title={isSeedEditable ? '锁定种子（将使用随机）' : '编辑种子'}
                  >
                    <Edit2 size={14} />
                  </button>
                </div>
                <p className="text-white/40 text-[10px] mt-1">
                  {isSeedEditable ? '将使用此种子值生成' : '默认使用随机种子（点击铅笔按钮可固定种子）'}
                </p>
              </div>

              {/* 角色列表 */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-white/70 text-xs font-mono-retro tracking-wide">角色列表</label>
                  <button
                    onClick={() => {
                      const newChar: CharacterCaption = {
                        char_caption: '1girl, ',
                        centers: [{ x: 0.5, y: 0.5 }],
                      };
                      setEditedCharacters([...editedCharacters, newChar]);
                    }}
                    className="text-xs text-white/50 hover:text-white/80 transition-colors px-2 py-1 border border-white/10 rounded"
                  >
                    + 添加角色
                  </button>
                </div>
                
                <div className="space-y-3">
                  {editedCharacters.map((char, idx) => (
                    <div key={idx} className="bg-black/20 border border-white/10 rounded p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-white/50 text-xs font-mono">角色 {idx + 1}</span>
                        <button
                          onClick={() => {
                            const updated = [...editedCharacters];
                            updated[idx] = { ...updated[idx], disabled: !updated[idx].disabled };
                            setEditedCharacters(updated);
                          }}
                          className={`text-xs px-2 py-0.5 rounded transition-colors ${
                            char.disabled
                              ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                              : 'bg-green-500/20 text-green-300 border border-green-500/30'
                          }`}
                        >
                          {char.disabled ? '已禁用' : '已启用'}
                        </button>
                        <button
                          onClick={() => {
                            setEditedCharacters(editedCharacters.filter((_, i) => i !== idx));
                          }}
                          className="ml-auto text-white/30 hover:text-red-400 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      
                      <textarea
                        value={char.char_caption}
                        onChange={e => {
                          const updated = [...editedCharacters];
                          updated[idx] = { ...updated[idx], char_caption: e.target.value };
                          setEditedCharacters(updated);
                        }}
                        className="w-full bg-black/30 border border-white/10 rounded px-2 py-1.5 text-white/90 text-xs font-mono resize-none focus:border-white/30 focus:outline-none transition-colors"
                        rows={2}
                        placeholder="角色外貌 tags..."
                        disabled={char.disabled}
                      />
                      
                      <div className="flex gap-2 text-xs">
                        <input
                          type="number"
                          value={char.centers[0].x}
                          onChange={e => {
                            const updated = [...editedCharacters];
                            updated[idx].centers[0].x = parseFloat(e.target.value) || 0;
                            setEditedCharacters(updated);
                          }}
                          className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1 text-white/90 font-mono focus:border-white/30 focus:outline-none"
                          placeholder="X (0-1)"
                          step="0.05"
                          min="0"
                          max="1"
                          disabled={char.disabled}
                        />
                        <input
                          type="number"
                          value={char.centers[0].y}
                          onChange={e => {
                            const updated = [...editedCharacters];
                            updated[idx].centers[0].y = parseFloat(e.target.value) || 0;
                            setEditedCharacters(updated);
                          }}
                          className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1 text-white/90 font-mono focus:border-white/30 focus:outline-none"
                          placeholder="Y (0-1)"
                          step="0.05"
                          min="0"
                          max="1"
                          disabled={char.disabled}
                        />
                      </div>
                    </div>
                  ))}
                  
                  {editedCharacters.length === 0 && (
                    <div className="text-white/30 text-xs text-center py-4">暂无角色</div>
                  )}
                </div>
              </div>
            </div>

            {/* 底部按钮 */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10">
              <button
                onClick={handleCloseEdit}
                className="px-4 py-2 text-sm text-white/60 hover:text-white/90 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleRegenerateWithEdits}
                disabled={isRegenerating}
                className="px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white/90 rounded border border-white/20 transition-colors disabled:opacity-50"
              >
                {isRegenerating ? '生成中...' : '确认并生成'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
