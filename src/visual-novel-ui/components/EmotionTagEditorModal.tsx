import React, { useState, useEffect } from 'react';
import { X, Save, Trash2, RefreshCw } from './Icons';
import type { DialogueSegment } from '../types';
import { getEmotionTags, putEmotionTags, deleteEmotionTags } from '../services/emotionTagCacheDB';
import { hashVoiceConfig, makeEmotionTagCacheKey } from '../services/emotionTagCacheDB';

interface EmotionTagEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  segment: DialogueSegment;
  messageId: number | null;
  characterVoices: Record<string, any>;
  onSave: (styleTag: string, textWithInlineTags: string) => void;
  playSfx: () => void;
}

export const EmotionTagEditorModal: React.FC<EmotionTagEditorModalProps> = ({
  isOpen,
  onClose,
  segment,
  messageId,
  characterVoices,
  onSave,
  playSfx,
}) => {
  const [styleTag, setStyleTag] = useState('');
  const [textWithInlineTags, setTextWithInlineTags] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // 加载当前段落的情绪标签
  useEffect(() => {
    if (!isOpen || messageId === null) return;

    const loadTags = async () => {
      const voiceHash = hashVoiceConfig(characterVoices);
      const cacheKey = makeEmotionTagCacheKey(messageId, voiceHash);
      const cached = await getEmotionTags(cacheKey);

      const emotionTag = cached?.[segment.id] || segment.emotionTags;
      setStyleTag(emotionTag?.styleTag || '');
      setTextWithInlineTags(emotionTag?.textWithInlineTags || segment.text || '');
    };

    loadTags();
  }, [isOpen, messageId, segment, characterVoices]);
  // 保存修改
  const handleSave = async () => {
    if (messageId === null) return;
    
    playSfx();
    setIsSaving(true);

    try {
      const voiceHash = hashVoiceConfig(characterVoices);
      const cacheKey = makeEmotionTagCacheKey(messageId, voiceHash);

      // 读取现有缓存
      const existing = await getEmotionTags(cacheKey) || {};
      
      // 更新当前段落的情绪标签
      existing[segment.id] = {
        styleTag,
        textWithInlineTags,
      };

      await putEmotionTags(cacheKey, existing);
      
      // 通知父组件更新并重新生成语音
      onSave(styleTag, textWithInlineTags);
      onClose();
    } catch (e) {
      console.error('[EmotionTagEditor] 保存失败:', e);
      alert('❌ 保存失败，请检查控制台');
    } finally {
      setIsSaving(false);
    }
  };

  // 清除当前段落的情绪标签
  const handleClear = async () => {
    if (messageId === null) return;
    
    if (!confirm('确定要清除当前对话的情绪标签吗？将使用默认标签重新生成语音。')) {
      return;
    }

    playSfx();
    setIsClearing(true);

    try {
      const voiceHash = hashVoiceConfig(characterVoices);
      const cacheKey = makeEmotionTagCacheKey(messageId, voiceHash);
      
      // 读取现有缓存
      const existing = await getEmotionTags(cacheKey) || {};
      
      // 删除当前段落的标签
      delete existing[segment.id];
      
      // 如果还有其他段落的标签，保存；否则删除整个缓存
      if (Object.keys(existing).length > 0) {
        await putEmotionTags(cacheKey, existing);
      } else {
        await deleteEmotionTags(cacheKey);
      }
      
      // 清空本地输入框
      setStyleTag('');
      setTextWithInlineTags(segment.text || '');
      
      // 触发重新生成语音
      onSave('', segment.text || '');
      onClose();
    } catch (e) {
      console.error('[EmotionTagEditor] 清除失败:', e);
      alert('❌ 清除失败，请检查控制台');
    } finally {
      setIsClearing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 animate-in fade-in duration-200">
      {/* 背景遮罩 */}
      <div className="absolute inset-0 cozy-overlay" onClick={onClose} />

      {/* 弹窗内容 */}
      <div className="relative cozy-surface max-w-xl w-full max-h-[90vh] rounded-[24px] shadow-[0_20px_40px_rgba(109,88,76,0.15)] overflow-hidden flex flex-col">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-4 sm:px-8 py-4 sm:py-6 border-b border-[color:rgba(161,132,117,0.16)] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-cozy-accent)] animate-pulse" />
            <h2 className="font-mono-retro text-xs sm:text-sm tracking-[0.2em] text-[var(--color-cozy-ink)]">
              编辑情绪标签
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-[rgba(161,132,117,0.08)] transition-colors cursor-pointer"
          >
            <X size={16} className="text-[var(--color-cozy-muted)]" />
          </button>
        </div>

        {/* 内容区 - 可滚动 */}
        <div className="px-4 sm:px-8 py-4 sm:py-6 overflow-y-auto flex-1">
          {/* 角色和台词 */}
          <div className="mb-4 sm:mb-6">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-mono-retro text-[10px] text-[var(--color-cozy-accent)] tracking-[0.15em]">
                {segment.speaker || segment.char}
              </span>
              <span className="font-mono-retro text-[8px] text-[var(--color-cozy-muted)] tracking-[0.1em]">
                #{segment.id}
              </span>
            </div>
            <p className="font-mono-retro text-[11px] text-[var(--color-cozy-ink)] leading-relaxed bg-[rgba(221,184,176,0.08)] px-3 sm:px-4 py-2 sm:py-3 rounded-lg break-words">
              {segment.text}
            </p>
          </div>

          {/* 风格标签 */}
          <div className="mb-3 sm:mb-4">
            <label className="block font-mono-retro text-[9px] text-[var(--color-cozy-muted)] tracking-[0.1em] mb-2 uppercase">
              Style Tag (风格标签)
            </label>
            <input
              type="text"
              value={styleTag}
              onChange={e => setStyleTag(e.target.value)}
              placeholder="例如: happy, sad, angry, neutral"
              className="w-full px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-ink)] text-[11px] font-mono-retro placeholder:text-[var(--color-cozy-muted)] placeholder:opacity-50 focus:outline-none focus:border-[var(--color-cozy-accent)] focus:shadow-[0_0_0_2px_rgba(221,184,176,0.2)] transition-all duration-200"
            />
          </div>

          {/* 带内联标签的文本 */}
          <div className="mb-4 sm:mb-6">
            <label className="block font-mono-retro text-[9px] text-[var(--color-cozy-muted)] tracking-[0.1em] mb-2 uppercase">
              Text With Inline Tags (内联标签文本)
            </label>
            <textarea
              value={textWithInlineTags}
              onChange={e => setTextWithInlineTags(e.target.value)}
              placeholder="例如: [happy]你好！[normal]很高兴见到你。"
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-ink)] text-[11px] font-mono-retro placeholder:text-[var(--color-cozy-muted)] placeholder:opacity-50 focus:outline-none focus:border-[var(--color-cozy-accent)] focus:shadow-[0_0_0_2px_rgba(221,184,176,0.2)] transition-all duration-200 resize-none"
            />
          </div>

          {/* 提示 */}
          <div className="mb-4 sm:mb-6 px-3 sm:px-4 py-2 sm:py-3 bg-[rgba(221,184,176,0.08)] rounded-lg">
            <p className="font-mono-retro text-[9px] text-[var(--color-cozy-muted)] tracking-[0.1em] leading-relaxed">
              💡 修改后点击保存，语音会自动重新生成。styleTag 设置全局情绪风格，textWithInlineTags 可以为不同片段设置不同情绪。
            </p>
          </div>

          {/* 按钮组 */}
          <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
            <button
              onClick={handleClear}
              disabled={isClearing || messageId === null}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-[color:rgba(186,127,106,0.25)] bg-[rgba(186,127,106,0.06)] text-[var(--color-cozy-muted)] hover:text-[#b86f6f] hover:bg-[rgba(184,111,111,0.08)] hover:border-[color:rgba(184,111,111,0.3)] transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 size={12} />
              <span className="font-mono-retro text-[10px] tracking-[0.15em]">
                {isClearing ? '清除中...' : '清除标签'}
              </span>
            </button>

            <button
              onClick={handleSave}
              disabled={isSaving || messageId === null}
              className="flex items-center justify-center gap-2 px-6 py-2 rounded-xl bg-[var(--color-cozy-accent)] text-white text-[11px] font-mono-retro tracking-[0.15em] hover:shadow-[0_4px_12px_rgba(221,184,176,0.3)] transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <RefreshCw size={12} className="animate-spin" />
                  <span>保存中...</span>
                </>
              ) : (
                <>
                  <Save size={12} />
                  <span>保存修改</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
