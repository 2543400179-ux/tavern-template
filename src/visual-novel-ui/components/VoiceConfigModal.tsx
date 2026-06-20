import React, { useState } from 'react';
import type { VoiceConfig } from '../types';
import { Loader2, Plus, Trash2, Volume2, X } from './Icons';
import { clearAllVoiceCache, getVoiceCacheStats } from '../services/voiceCacheDB';

interface VoiceConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentConfig?: VoiceConfig;
  onSave: (config: VoiceConfig) => Promise<void>;
  playSfx: () => void;
}

export const VoiceConfigModal: React.FC<VoiceConfigModalProps> = ({
  isOpen,
  onClose,
  currentConfig,
  onSave,
  playSfx,
}) => {
  const [config, setConfig] = useState<VoiceConfig>(
    currentConfig || {
      enabled: true,
      autoPlay: true, // 保留字段但界面不显示
      preloadEnabled: false, // 默认关闭预加载
      apiKey: '',
      model: 'mimo-v2.5-tts-voiceclone', // 固定使用音频克隆模型
      characterVoices: {},
      enableEmotionTags: false, // 默认关闭情绪标签
      emotionTagLLM: {
        endpoint: '',
        apiKey: '',
        model: '',
      },
    },
  );

  const [isSaving, setIsSaving] = useState(false);
  const [newCharName, setNewCharName] = useState('');
  const [newVoiceUrl, setNewVoiceUrl] = useState('');
  const [newCharInfo, setNewCharInfo] = useState('');
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [cacheStats, setCacheStats] = useState<{ count: number; totalSizeMB: number } | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const handleSave = async () => {
    playSfx();
    setIsSaving(true);
    try {
      await onSave(config);
      onClose();
    } catch (e) {
      console.error('[VoiceConfigModal] 保存失败:', e);
      alert('保存失败，请检查控制台');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddCharacter = () => {
    const name = newCharName.trim();
    const url = newVoiceUrl.trim();
    const info = newCharInfo.trim();
    if (!name) {
      alert('请输入角色名');
      return;
    }
    if (!url) {
      alert('请输入音色 URL');
      return;
    }
    if (config.characterVoices[name]) {
      alert('角色已存在');
      return;
    }
    playSfx();
    setConfig({
      ...config,
      characterVoices: {
        ...config.characterVoices,
        [name]: {
          voice: url,
          volume: 1.0,
          stylePrompt: '',
          characterInfo: info || undefined,
        },
      },
    });
    setNewCharName('');
    setNewVoiceUrl('');
    setNewCharInfo('');
  };

  const handleDeleteCharacter = (name: string) => {
    playSfx();
    const newVoices = { ...config.characterVoices };
    delete newVoices[name];
    setConfig({ ...config, characterVoices: newVoices });
  };

  const handleUpdateVoiceUrl = (name: string, url: string) => {
    setConfig({
      ...config,
      characterVoices: {
        ...config.characterVoices,
        [name]: {
          ...config.characterVoices[name],
          voice: url,
        },
      },
    });
  };

  // 加载缓存统计
  const loadCacheStats = async () => {
    const stats = await getVoiceCacheStats();
    setCacheStats(stats);
  };

  // 清除缓存
  const handleClearCache = async () => {
    playSfx();
    setIsClearingCache(true);
    try {
      await clearAllVoiceCache();
      await loadCacheStats(); // 刷新统计
      alert('✅ 语音缓存已清空');
    } catch (e) {
      console.error('[VoiceConfigModal] 清理缓存失败:', e);
      alert('❌ 清理缓存失败，请检查控制台');
    } finally {
      setIsClearingCache(false);
    }
  };

  // 加载情绪标签 LLM 模型列表
  const loadEmotionTagModels = async () => {
    const endpoint = config.emotionTagLLM?.endpoint?.trim();
    const apiKey = config.emotionTagLLM?.apiKey?.trim();
    
    if (!endpoint || !apiKey) {
      alert('请先配置 API Endpoint 和 API Key');
      return;
    }

    playSfx();
    setIsLoadingModels(true);
    try {
      const response = await fetch(`${endpoint}/v1/models`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const models = data.data?.map((m: any) => m.id) || [];
      setAvailableModels(models);
      
      if (models.length === 0) {
        alert('⚠️ 未找到可用模型');
      }
    } catch (e) {
      console.error('[VoiceConfigModal] 加载模型列表失败:', e);
      alert('❌ 加载模型列表失败，请检查 Endpoint 和 API Key');
    } finally {
      setIsLoadingModels(false);
    }
  };

  // 打开弹窗时加载缓存统计
  React.useEffect(() => {
    if (isOpen) {
      loadCacheStats();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="game-modal absolute inset-0 z-[60] cozy-overlay flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl h-auto max-h-[85vh] cozy-surface border-[color:var(--color-cozy-border-strong)] relative overflow-hidden flex flex-col rounded-[24px]">
        {/* 背景光效 */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-[radial-gradient(circle_at_top_right,rgba(221,184,176,0.15),transparent_70%)] pointer-events-none" />

        {/* Header */}
        <div className="flex justify-between items-center px-8 py-6 border-b border-[color:rgba(161,132,117,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.4),transparent)]">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-[var(--color-cozy-accent)] opacity-80" />
              <h2 className="font-serif-sc text-[17px] text-[var(--color-cozy-ink)] tracking-[0.1em] font-bold">
                语音配置
              </h2>
            </div>
            <span className="font-mono-retro text-[8px] text-[var(--color-cozy-muted)] tracking-[0.3em] uppercase ml-3.5">
              voice_config
            </span>
          </div>
          <button
            onClick={() => {
              playSfx();
              onClose();
            }}
            className="w-8 h-8 flex items-center justify-center bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.18)] rounded-full text-[var(--color-cozy-muted)] hover:text-[var(--color-cozy-ink)] hover:bg-[rgba(255,255,255,0.8)] shadow-[0_4px_12px_rgba(109,88,76,0.08)] transition-all duration-300 cursor-pointer group"
            onMouseEnter={playSfx}
          >
            <X size={14} className="group-hover:rotate-90 transition-transform duration-300" />
          </button>
        </div>

        {/* Body */}
        <div className="px-8 py-6 flex flex-col gap-5 overflow-y-auto cozy-scrollbar flex-1">
          {/* 启用语音预加载 */}
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <Volume2 size={14} className="text-[var(--color-cozy-muted)]" />
                <span className="font-serif-sc text-[13px] text-[var(--color-cozy-ink)]">启用语音预加载</span>
              </div>
              <span className="font-mono-retro text-[8px] text-[var(--color-cozy-muted)] tracking-[0.1em] ml-5">
                楼层加载时提前生成所有角色语音（类似 CG 预加载）
              </span>
            </div>
            <ToggleSwitch checked={config.preloadEnabled ?? false} onChange={checked => setConfig({ ...config, preloadEnabled: checked })} />
          </div>

          <div className="cozy-hairline h-px w-full opacity-60" />

          {/* API 配置 */}
          <SectionHeader title="MiMo API" subtitle="TTS_SERVICE" />

          <InputField
            label="API Key"
            placeholder="sk-..."
            value={config.apiKey}
            onChange={val => setConfig({ ...config, apiKey: val })}
            type="password"
          />

          <div className="cozy-hairline h-px w-full opacity-60" />

          {/* 角色音色配置 */}
          <SectionHeader title="角色音色" subtitle="CHARACTER_VOICES" />

          <div className="flex items-center justify-between">
            <span className="font-mono-retro text-[9px] text-[var(--color-cozy-muted)] tracking-[0.15em]">
              {Object.keys(config.characterVoices).length} 个角色
            </span>
          </div>

          {/* 添加新角色 */}
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={newCharName}
              onChange={e => setNewCharName(e.target.value)}
              placeholder="角色名（必须与 AI 输出的 [char:xxx] 完全一致）"
              className="w-full px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-ink)] text-[12px] font-mono-retro placeholder:text-[var(--color-cozy-muted)] placeholder:opacity-50 focus:outline-none focus:border-[var(--color-cozy-accent)] transition-all duration-200"
            />
            <input
              type="text"
              value={newVoiceUrl}
              onChange={e => setNewVoiceUrl(e.target.value)}
              placeholder="音色 URL（音频文件链接，用于克隆该角色音色）"
              className="w-full px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-ink)] text-[12px] font-mono-retro placeholder:text-[var(--color-cozy-muted)] placeholder:opacity-50 focus:outline-none focus:border-[var(--color-cozy-accent)] transition-all duration-200"
            />
            <input
              type="text"
              value={newCharInfo}
              onChange={e => setNewCharInfo(e.target.value)}
              placeholder="角色信息（可选，用于情绪标签 LLM 生成更准确的情绪）"
              className="w-full px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-ink)] text-[12px] font-mono-retro placeholder:text-[var(--color-cozy-muted)] placeholder:opacity-50 focus:outline-none focus:border-[var(--color-cozy-accent)] transition-all duration-200"
            />
            <button
              onClick={handleAddCharacter}
              className="self-end px-4 py-2 rounded-lg bg-[var(--color-cozy-accent)] text-white text-[11px] font-mono-retro tracking-[0.15em] hover:shadow-[0_2px_8px_rgba(221,184,176,0.4)] transition-all duration-200 cursor-pointer flex items-center gap-1.5"
            >
              <Plus size={13} />
              添加角色
            </button>
          </div>

          {/* 已添加的角色列表 */}
          <div className="flex flex-col gap-2 max-h-[240px] overflow-y-auto cozy-scrollbar">
            {Object.keys(config.characterVoices).length === 0 ? (
              <div className="text-center py-6 text-[var(--color-cozy-muted)] font-mono-retro text-[10px] tracking-[0.15em]">
                暂无角色，请在上方添加
              </div>
            ) : (
              Object.entries(config.characterVoices).map(([name, voice]) => (
                <div
                  key={name}
                  className="flex flex-col gap-2 px-4 py-3 rounded-xl bg-[rgba(255,255,255,0.4)] border border-[color:rgba(161,132,117,0.12)] hover:bg-[rgba(255,255,255,0.6)] transition-all duration-200"
                >
                  {/* 第一行：角色名和删除按钮 */}
                  <div className="flex items-center justify-between">
                    <span className="font-serif-sc text-[13px] text-[var(--color-cozy-ink)] font-bold">
                      {name}
                    </span>
                    <button
                      onClick={() => handleDeleteCharacter(name)}
                      className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-[rgba(255,255,255,0.6)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-muted)] hover:text-[#b86f6f] hover:bg-white transition-all duration-200 cursor-pointer"
                      title="删除角色"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>

                  {/* 音色 URL */}
                  <input
                    type="text"
                    value={voice.voice || ''}
                    onChange={e => handleUpdateVoiceUrl(name, e.target.value)}
                    placeholder="音色 URL"
                    className="w-full px-3 py-1.5 rounded-lg bg-white border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-ink)] text-[11px] font-mono-retro placeholder:text-[var(--color-cozy-muted)] placeholder:opacity-50 focus:outline-none focus:border-[var(--color-cozy-accent)] transition-all duration-200"
                  />

                  {/* 角色信息 */}
                  <input
                    type="text"
                    value={voice.characterInfo || ''}
                    onChange={e => setConfig({
                      ...config,
                      characterVoices: {
                        ...config.characterVoices,
                        [name]: {
                          ...config.characterVoices[name],
                          characterInfo: e.target.value || undefined,
                        },
                      },
                    })}
                    placeholder="角色信息（可选，用于情绪标签）"
                    className="w-full px-3 py-1.5 rounded-lg bg-white border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-ink)] text-[11px] font-mono-retro placeholder:text-[var(--color-cozy-muted)] placeholder:opacity-50 focus:outline-none focus:border-[var(--color-cozy-accent)] transition-all duration-200"
                  />
                </div>
              ))
            )}
          </div>

          <span className="font-mono-retro text-[8px] text-[var(--color-cozy-muted)] tracking-[0.2em] opacity-50">
            数据来源: 世界书 [res]角色语音
          </span>

          <div className="cozy-hairline h-px w-full opacity-60" />

          {/* 情绪标签配置 */}
          <SectionHeader title="情绪标签" subtitle="EMOTION_TAGS" />

          {/* 启用情绪标签开关 */}
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="font-serif-sc text-[13px] text-[var(--color-cozy-ink)]">启用情绪标签</span>
              <span className="font-mono-retro text-[8px] text-[var(--color-cozy-muted)] tracking-[0.1em]">
                使用 LLM 自动分析台词情绪并添加 MiMo 情绪标签
              </span>
            </div>
            <ToggleSwitch 
              checked={config.enableEmotionTags ?? false} 
              onChange={checked => setConfig({ 
                ...config, 
                enableEmotionTags: checked,
                emotionTagLLM: checked ? (config.emotionTagLLM || {
                  endpoint: '',
                  apiKey: '',
                  model: '',
                }) : config.emotionTagLLM
              })} 
            />
          </div>

          {/* 情绪标签 LLM API 配置（仅在启用时显示） */}
          {config.enableEmotionTags && (
            <div className="flex flex-col gap-3 pl-4 border-l-2 border-[color:var(--color-cozy-accent)] border-opacity-30">
              <InputField
                label="API Endpoint"
                placeholder="https://api.openai.com"
                value={config.emotionTagLLM?.endpoint || ''}
                onChange={val => setConfig({
                  ...config,
                  emotionTagLLM: { ...config.emotionTagLLM!, endpoint: val }
                })}
              />

              <InputField
                label="API Key"
                placeholder="sk-..."
                value={config.emotionTagLLM?.apiKey || ''}
                onChange={val => setConfig({
                  ...config,
                  emotionTagLLM: { ...config.emotionTagLLM!, apiKey: val }
                })}
                type="password"
              />

              {/* 模型选择 */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono-retro text-[9px] text-[var(--color-cozy-muted)] tracking-[0.15em] uppercase">
                    Model
                  </span>
                  <button
                    onClick={loadEmotionTagModels}
                    disabled={isLoadingModels}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-muted)] hover:text-[var(--color-cozy-ink)] hover:bg-white transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoadingModels ? (
                      <>
                        <Loader2 size={10} className="animate-spin" />
                        <span className="font-mono-retro text-[8px] tracking-[0.1em]">加载中...</span>
                      </>
                    ) : (
                      <>
                        <Volume2 size={10} />
                        <span className="font-mono-retro text-[8px] tracking-[0.1em]">刷新模型</span>
                      </>
                    )}
                  </button>
                </div>
                
                {availableModels.length > 0 ? (
                  <select
                    value={config.emotionTagLLM?.model || ''}
                    onChange={e => setConfig({
                      ...config,
                      emotionTagLLM: { ...config.emotionTagLLM!, model: e.target.value }
                    })}
                    className="w-full px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-ink)] text-[12px] font-mono-retro focus:outline-none focus:border-[var(--color-cozy-accent)] transition-all duration-200"
                  >
                    <option value="">选择模型</option>
                    {availableModels.map(model => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={config.emotionTagLLM?.model || ''}
                    onChange={e => setConfig({
                      ...config,
                      emotionTagLLM: { ...config.emotionTagLLM!, model: e.target.value }
                    })}
                    placeholder="输入模型名称或点击刷新获取列表"
                    className="w-full px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-ink)] text-[12px] font-mono-retro placeholder:text-[var(--color-cozy-muted)] placeholder:opacity-50 focus:outline-none focus:border-[var(--color-cozy-accent)] transition-all duration-200"
                  />
                )}
              </div>
            </div>
          )}

          <div className="cozy-hairline h-px w-full opacity-60" />

          {/* 缓存管理 */}
          <SectionHeader title="缓存管理" subtitle="CACHE_MANAGEMENT" />

          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="font-mono-retro text-[10px] text-[var(--color-cozy-ink)] tracking-[0.1em]">
                {cacheStats ? `${cacheStats.count} 条缓存` : '加载中...'}
              </span>
              <span className="font-mono-retro text-[9px] text-[var(--color-cozy-muted)] tracking-[0.1em]">
                {cacheStats ? `${cacheStats.totalSizeMB.toFixed(2)} MB` : ''}
              </span>
            </div>
            <button
              onClick={handleClearCache}
              disabled={isClearingCache}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-[color:rgba(186,127,106,0.25)] bg-[rgba(186,127,106,0.06)] text-[var(--color-cozy-muted)] hover:text-[#b86f6f] hover:bg-[rgba(184,111,111,0.08)] hover:border-[color:rgba(184,111,111,0.3)] transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 size={12} />
              <span className="font-mono-retro text-[10px] tracking-[0.15em]">
                {isClearingCache ? '清理中...' : '清理缓存'}
              </span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-4 border-t border-[color:rgba(161,132,117,0.16)] bg-[rgba(255,255,255,0.3)] flex justify-between items-center">
          <span className="text-[9px] font-mono-retro text-[var(--color-cozy-muted)] tracking-[0.2em] opacity-80">
            QUIET_EDITOR_UI
          </span>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-6 py-2 rounded-xl bg-[var(--color-cozy-accent)] text-white text-[11px] font-mono-retro tracking-[0.15em] hover:shadow-[0_4px_12px_rgba(221,184,176,0.3)] transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                保存中...
              </>
            ) : (
              '保存配置'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// ====== 通用组件 ======

const SectionHeader: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <div className="flex items-center gap-2 mt-1">
    <div className="text-[var(--color-cozy-accent)] opacity-80">
      <Volume2 size={13} />
    </div>
    <span className="font-serif-sc text-[13px] text-[var(--color-cozy-ink)] font-bold">{title}</span>
    <span className="font-mono-retro text-[8px] text-[var(--color-cozy-muted)] tracking-[0.2em] uppercase">
      {subtitle}
    </span>
  </div>
);

const InputField: React.FC<{
  label: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  type?: string;
}> = ({ label, value, onChange, placeholder, type = 'text' }) => (
  <div className="flex flex-col gap-1.5">
    <label className="font-mono-retro text-[9px] text-[var(--color-cozy-muted)] tracking-[0.15em] uppercase">
      {label}
    </label>
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-ink)] text-[12px] font-mono-retro placeholder:text-[var(--color-cozy-muted)] placeholder:opacity-50 focus:outline-none focus:border-[var(--color-cozy-accent)] focus:shadow-[0_0_0_2px_rgba(221,184,176,0.2)] transition-all duration-200"
    />
  </div>
);

const ToggleSwitch: React.FC<{ checked: boolean; onChange: (checked: boolean) => void }> = ({ checked, onChange }) => (
  <button
    onClick={() => onChange(!checked)}
    className={`relative w-10 h-5 rounded-full transition-all duration-300 cursor-pointer ${
      checked ? 'bg-[var(--color-cozy-accent)] shadow-[0_2px_8px_rgba(221,184,176,0.4)]' : 'bg-[rgba(161,132,117,0.2)]'
    }`}
  >
    <div
      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.15)] transition-all duration-300 ${
        checked ? 'left-[22px]' : 'left-0.5'
      }`}
    />
  </button>
);
