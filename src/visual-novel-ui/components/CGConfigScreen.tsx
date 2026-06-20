import React, { useCallback, useEffect, useRef, useState } from 'react';
import { clearAllCGCache } from '../services/cgCache';
import { loadCGSettings, saveCGSettings } from '../services/cgTaskManager';
import {
  deleteCharacterAppearance,
  loadCharacterAppearances,
  upsertCharacterAppearance,
} from '../services/characterAppearances';
import {
  createScheme,
  deleteScheme,
  loadVibeStorage,
  parseVibeBundle,
  removeVibeFromScheme,
  renameScheme,
  saveVibeStorage,
  setActiveScheme,
  updateVibeParams,
} from '../services/vibeManager';
import type { CGGenerationSettings, VibeScheme } from '../types';
import { Camera, Database, Download, Image, Key, Loader2, Pencil, Plus, RefreshCw, Server, Trash2, Upload, X } from './Icons';

interface CGConfigScreenProps {
  onClose: () => void;
  playSfx: () => void;
}

type ConfigTab = 'general' | 'characters' | 'vibe';

export const CGConfigScreen: React.FC<CGConfigScreenProps> = ({ onClose, playSfx }) => {
  const [activeTab, setActiveTab] = useState<ConfigTab>('general');
  const [cgSettings, setCgSettings] = useState<CGGenerationSettings>(() => loadCGSettings());
  const [isClearingCache, setIsClearingCache] = useState(false);

  // 角色外貌库状态
  const [charAppearances, setCharAppearances] = useState<Record<string, string>>({});
  const [isLoadingChars, setIsLoadingChars] = useState(false);
  const [editingChar, setEditingChar] = useState<{ name: string; tags: string; isNew?: boolean } | null>(null);

  // Vibe 方案状态
  const [vibeSchemes, setVibeSchemes] = useState<VibeScheme[]>([]);
  const [activeSchemeId, setActiveSchemeId] = useState<string | null>(null);
  const [isUploadingVibe, setIsUploadingVibe] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // CG 设置变更处理
  const updateCGSettings = useCallback((updater: (prev: CGGenerationSettings) => CGGenerationSettings) => {
    setCgSettings(prev => {
      const next = updater(prev);
      saveCGSettings(next);
      return next;
    });
  }, []);

  const handleClearCache = useCallback(async () => {
    setIsClearingCache(true);
    try {
      await clearAllCGCache();
    } catch (e) {
      console.error('[CGConfigScreen] 清理缓存失败:', e);
    } finally {
      setIsClearingCache(false);
    }
  }, []);

  // 加载角色外貌库
  const loadChars = useCallback(async () => {
    setIsLoadingChars(true);
    try {
      const data = await loadCharacterAppearances();
      setCharAppearances(data);
    } catch (e) {
      console.error('[CGConfigScreen] 加载角色外貌库失败:', e);
    } finally {
      setIsLoadingChars(false);
    }
  }, []);

  // 加载 Vibe 方案
  const loadVibes = useCallback(() => {
    const storage = loadVibeStorage();
    setVibeSchemes(storage.schemes);
    setActiveSchemeId(storage.activeSchemeId);
  }, []);

  // 切换到角色库 tab 时自动加载
  useEffect(() => {
    if (activeTab === 'characters' && Object.keys(charAppearances).length === 0) {
      loadChars();
    }
  }, [activeTab, loadChars]);

  // 切换到 Vibe tab 时自动加载
  useEffect(() => {
    if (activeTab === 'vibe') {
      loadVibes();
    }
  }, [activeTab, loadVibes]);

  // 保存角色外貌
  const handleSaveCharacter = useCallback(async () => {
    if (!editingChar || !editingChar.name.trim()) return;
    playSfx();
    try {
      await upsertCharacterAppearance(editingChar.name.trim(), editingChar.tags.trim());
      await loadChars();
      setEditingChar(null);
    } catch (e) {
      console.error('[CGConfigScreen] 保存角色外貌失败:', e);
    }
  }, [editingChar, playSfx, loadChars]);

  // 删除角色外貌
  const handleDeleteCharacter = useCallback(
    async (name: string) => {
      playSfx();
      try {
        await deleteCharacterAppearance(name);
        await loadChars();
      } catch (e) {
        console.error('[CGConfigScreen] 删除角色外貌失败:', e);
      }
    },
    [playSfx, loadChars],
  );

  // Vibe Bundle 文件上传（只支持 .naiv4vibebundle 格式）
  const handleVibeFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0 || !activeSchemeId) return;

      setIsUploadingVibe(true);
      playSfx();

      try {
        const file = files[0]; // 只处理第一个文件
        if (!file.name.endsWith('.naiv4vibebundle')) {
          throw new Error('只支持 .naiv4vibebundle 格式文件');
        }

        const content = await file.text();
        const vibeEntries = parseVibeBundle(content);

        // 将解析出的 vibe 条目添加到当前方案
        const storage = loadVibeStorage();
        const scheme = storage.schemes.find(s => s.id === activeSchemeId);
        if (!scheme) {
          throw new Error('当前方案不存在');
        }

        // 将 bundle 中的 vibe 添加到方案
        // 注意：.naiv4vibebundle 不包含图片，只有编码数据
        vibeEntries.forEach(entry => {
          const vibeEntry = {
            id: entry.id,
            fileName: entry.name,
            encoding: entry.encoding, // 直接存储编码数据
            infoExtracted: entry.infoExtracted,
            strength: entry.strength,
          };
          scheme.vibes.push(vibeEntry);
        });

        // 使用 saveVibeStorage 保存
        saveVibeStorage(storage);

        // 重新加载以更新 UI
        loadVibes();
      } catch (e: any) {
        console.error('[CGConfigScreen] 导入 Vibe Bundle 失败:', e);
        alert(`导入失败: ${e.message}`);
      } finally {
        setIsUploadingVibe(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [activeSchemeId, playSfx, loadVibes],
  );

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
                CG 配置
              </h2>
            </div>
            <span className="font-mono-retro text-[8px] text-[var(--color-cozy-muted)] tracking-[0.3em] uppercase ml-3.5">
              cg_config
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

        {/* Tab 切换 */}
        <div className="flex px-8 pt-4 gap-2">
          <TabButton
            active={activeTab === 'general'}
            onClick={() => {
              playSfx();
              setActiveTab('general');
            }}
            icon={<Camera size={13} />}
            label="通用"
          />
          <TabButton
            active={activeTab === 'characters'}
            onClick={() => {
              playSfx();
              setActiveTab('characters');
            }}
            icon={<Database size={13} />}
            label="角色库"
          />
          <TabButton
            active={activeTab === 'vibe'}
            onClick={() => {
              playSfx();
              setActiveTab('vibe');
            }}
            icon={<Image size={13} />}
            label="Vibe"
          />
        </div>

        {/* Body */}
        <div className="px-8 py-6 flex flex-col gap-5 overflow-y-auto cozy-scrollbar flex-1">
          {activeTab === 'general' && (
            <GeneralTab
              cgSettings={cgSettings}
              onUpdate={updateCGSettings}
              onClearCache={handleClearCache}
              isClearingCache={isClearingCache}
              playSfx={playSfx}
            />
          )}
          {activeTab === 'characters' && (
            <CharactersTab
              charAppearances={charAppearances}
              isLoading={isLoadingChars}
              editingChar={editingChar}
              onEdit={setEditingChar}
              onSave={handleSaveCharacter}
              onDelete={handleDeleteCharacter}
              onRefresh={loadChars}
              playSfx={playSfx}
            />
          )}
          {activeTab === 'vibe' && (
            <VibeTab
              schemes={vibeSchemes}
              activeSchemeId={activeSchemeId}
              onCreateScheme={name => {
                playSfx();
                createScheme(name);
                loadVibes();
              }}
              onDeleteScheme={id => {
                playSfx();
                deleteScheme(id);
                loadVibes();
              }}
              onRenameScheme={(id, name) => {
                playSfx();
                renameScheme(id, name);
                loadVibes();
              }}
              onSetActiveScheme={id => {
                playSfx();
                setActiveScheme(id);
                loadVibes();
              }}
              onUploadVibe={() => fileInputRef.current?.click()}
              onRemoveVibe={(schemeId, vibeId) => {
                playSfx();
                removeVibeFromScheme(schemeId, vibeId);
                loadVibes();
              }}
              onUpdateVibeParams={(schemeId, vibeId, params) => {
                updateVibeParams(schemeId, vibeId, params);
                loadVibes();
              }}
              isUploading={isUploadingVibe}
              playSfx={playSfx}
            />
          )}
        </div>

        {/* 底部信息 */}
        <div className="px-8 py-4 border-t border-[color:rgba(161,132,117,0.16)] bg-[rgba(255,255,255,0.3)] flex justify-between items-center">
          <span className="text-[9px] font-mono-retro text-[var(--color-cozy-muted)] tracking-[0.2em] opacity-80">
            QUIET_EDITOR_UI
          </span>
          <span className="text-[8px] font-mono-retro text-[var(--color-cozy-muted)] tracking-wider opacity-60">
            v1.3.0
          </span>
        </div>

        {/* 隐藏的文件上传 input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".naiv4vibebundle"
          className="hidden"
          onChange={handleVibeFileUpload}
        />
      </div>
    </div>
  );
};

// ====== Tab 按钮 ======
const TabButton: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({
  active,
  onClick,
  icon,
  label,
}) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-mono-retro tracking-[0.15em] transition-all duration-200 cursor-pointer ${
      active
        ? 'bg-[var(--color-cozy-accent)] text-white shadow-[0_2px_8px_rgba(221,184,176,0.4)]'
        : 'bg-[rgba(255,255,255,0.4)] text-[var(--color-cozy-muted)] hover:bg-[rgba(255,255,255,0.7)] border border-[color:rgba(161,132,117,0.12)]'
    }`}
  >
    {icon}
    {label}
  </button>
);

// ====== 通用 Tab ======
const GeneralTab: React.FC<{
  cgSettings: CGGenerationSettings;
  onUpdate: (updater: (prev: CGGenerationSettings) => CGGenerationSettings) => void;
  onClearCache: () => void;
  isClearingCache: boolean;
  playSfx: () => void;
}> = ({ cgSettings, onUpdate, onClearCache, isClearingCache, playSfx }) => {
  const [modelList, setModelList] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string>('');

  const handleFetchModels = useCallback(async () => {
    const { endpoint, apiKey } = cgSettings.directorLLM;
    if (!endpoint || !apiKey) {
      setModelError('请先填写 API 地址和 Key');
      return;
    }

    setIsLoadingModels(true);
    setModelError('');

    try {
      let modelsUrl = endpoint.trim();
      if (modelsUrl.endsWith('/chat/completions')) {
        modelsUrl = modelsUrl.replace('/chat/completions', '/models');
      } else {
        if (!modelsUrl.endsWith('/')) modelsUrl += '/';
        if (modelsUrl.endsWith('/v1/')) {
          modelsUrl += 'models';
        } else {
          modelsUrl += 'v1/models';
        }
      }

      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!response.ok) {
        throw new Error(`请求失败 (${response.status})`);
      }

      const data = await response.json();
      const models: string[] = (data?.data || [])
        .map((m: any) => m.id)
        .filter((id: string) => !!id)
        .sort();

      if (models.length === 0) {
        setModelError('未找到可用模型');
      } else {
        setModelList(models);
        setModelError('');
      }
    } catch (e: any) {
      setModelError(e?.message || '获取模型列表失败');
    } finally {
      setIsLoadingModels(false);
    }
  }, [cgSettings.directorLLM.endpoint, cgSettings.directorLLM.apiKey]);

  return (
    <>
      {/* 启用开关 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera size={14} className="text-[var(--color-cozy-muted)]" />
          <span className="font-serif-sc text-[13px] text-[var(--color-cozy-ink)]">启用 CG 生成</span>
        </div>
        <ToggleSwitch
          checked={cgSettings.enabled}
          onChange={checked => onUpdate(prev => ({ ...prev, enabled: checked }))}
        />
      </div>

      {/* 自动重绘开关 */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <RefreshCw size={13} className="text-[var(--color-cozy-muted)]" />
            <span className="font-serif-sc text-[12px] text-[var(--color-cozy-ink)]">缓存丢失时自动重绘</span>
          </div>
          <span className="font-mono-retro text-[8px] text-[var(--color-cozy-muted)] tracking-[0.1em] ml-5">
            关闭后需手动重新生成 CG
          </span>
        </div>
        <ToggleSwitch
          checked={cgSettings.autoRegenerate !== false}
          onChange={checked => onUpdate(prev => ({ ...prev, autoRegenerate: checked }))}
        />
      </div>

      {/* CG 预加载开关 */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Download size={13} className="text-[var(--color-cozy-muted)]" />
            <span className="font-serif-sc text-[12px] text-[var(--color-cozy-ink)]">启用 CG 预加载</span>
          </div>
          <span className="font-mono-retro text-[8px] text-[var(--color-cozy-muted)] tracking-[0.1em] ml-5">
            楼层加载时提前生成所有 CG（类似语音预加载）
          </span>
        </div>
        <ToggleSwitch
          checked={cgSettings.preloadEnabled ?? false}
          onChange={checked => onUpdate(prev => ({ ...prev, preloadEnabled: checked }))}
        />
      </div>

      {/* 全CG模式开关 */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Image size={13} className="text-[var(--color-cozy-muted)]" />
            <span className="font-serif-sc text-[12px] text-[var(--color-cozy-ink)]">全 CG 覆盖模式</span>
          </div>
          <span className="font-mono-retro text-[8px] text-[var(--color-cozy-muted)] tracking-[0.1em] ml-5">
            所有文段都显示 CG，没有 CG 的段落继续显示上一个 CG
          </span>
        </div>
        <ToggleSwitch
          checked={cgSettings.fullCoverageMode !== false}
          onChange={checked => onUpdate(prev => ({ ...prev, fullCoverageMode: checked }))}
        />
      </div>

      <div className="cozy-hairline h-px w-full opacity-60" />

      {/* 导演 LLM 配置 */}
      <SectionHeader icon={<Server size={13} />} title="导演 LLM" subtitle="DIRECTOR_LLM" />

      <InputField
        label="API 地址"
        placeholder="https://api.openai.com/v1"
        value={cgSettings.directorLLM.endpoint}
        onChange={val => onUpdate(prev => ({ ...prev, directorLLM: { ...prev.directorLLM, endpoint: val } }))}
        type="url"
      />
      <InputField
        label="API Key"
        placeholder="sk-..."
        value={cgSettings.directorLLM.apiKey}
        onChange={val => onUpdate(prev => ({ ...prev, directorLLM: { ...prev.directorLLM, apiKey: val } }))}
        type="password"
      />

      {/* 模型选择 */}
      <div className="flex flex-col gap-1.5">
        <label className="font-mono-retro text-[9px] text-[var(--color-cozy-muted)] tracking-[0.15em] uppercase">
          模型名称
        </label>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={cgSettings.directorLLM.model}
            onChange={e => onUpdate(prev => ({ ...prev, directorLLM: { ...prev.directorLLM, model: e.target.value } }))}
            placeholder="点击右侧按钮获取模型列表"
            className="flex-1 px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-ink)] text-[12px] font-mono-retro placeholder:text-[var(--color-cozy-muted)] placeholder:opacity-50 focus:outline-none focus:border-[var(--color-cozy-accent)] focus:shadow-[0_0_0_2px_rgba(221,184,176,0.2)] transition-all duration-200"
          />
          <button
            onClick={() => {
              playSfx();
              handleFetchModels();
            }}
            disabled={isLoadingModels}
            title="获取模型列表"
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-[color:rgba(161,132,117,0.2)] bg-[rgba(255,255,255,0.5)] text-[var(--color-cozy-muted)] hover:text-[var(--color-cozy-ink)] hover:bg-[rgba(255,255,255,0.8)] transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoadingModels ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>

        {modelError && (
          <span className="font-mono-retro text-[9px] text-[#b86f6f] tracking-[0.1em]">⚠ {modelError}</span>
        )}

        {modelList.length > 0 && (
          <select
            value={cgSettings.directorLLM.model}
            onChange={e => {
              playSfx();
              onUpdate(prev => ({ ...prev, directorLLM: { ...prev.directorLLM, model: e.target.value } }));
            }}
            className="w-full px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-ink)] text-[11px] font-mono-retro focus:outline-none focus:border-[var(--color-cozy-accent)] transition-all duration-200 cursor-pointer"
          >
            <option value="">-- 选择模型 --</option>
            {modelList.map(model => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* CG 数量限制 */}
      <div className="flex gap-3">
        <div className="flex-1 flex flex-col gap-1.5">
          <label className="font-mono-retro text-[9px] text-[var(--color-cozy-muted)] tracking-[0.15em] uppercase">
            最少 CG 数量
          </label>
          <input
            type="number"
            min="0"
            placeholder="不限制"
            value={cgSettings.directorLLM.minCGCount ?? ''}
            onChange={e => {
              const val = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
              onUpdate(prev => ({ ...prev, directorLLM: { ...prev.directorLLM, minCGCount: val } }));
            }}
            className="px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-ink)] text-[12px] font-mono-retro placeholder:text-[var(--color-cozy-muted)] placeholder:opacity-50 focus:outline-none focus:border-[var(--color-cozy-accent)] focus:shadow-[0_0_0_2px_rgba(221,184,176,0.2)] transition-all duration-200"
          />
        </div>
        <div className="flex-1 flex flex-col gap-1.5">
          <label className="font-mono-retro text-[9px] text-[var(--color-cozy-muted)] tracking-[0.15em] uppercase">
            最多 CG 数量
          </label>
          <input
            type="number"
            min="0"
            placeholder="不限制"
            value={cgSettings.directorLLM.maxCGCount ?? ''}
            onChange={e => {
              const val = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
              onUpdate(prev => ({ ...prev, directorLLM: { ...prev.directorLLM, maxCGCount: val } }));
            }}
            className="px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-ink)] text-[12px] font-mono-retro placeholder:text-[var(--color-cozy-muted)] placeholder:opacity-50 focus:outline-none focus:border-[var(--color-cozy-accent)] focus:shadow-[0_0_0_2px_rgba(221,184,176,0.2)] transition-all duration-200"
          />
        </div>
      </div>
      <span className="font-mono-retro text-[9px] text-[var(--color-cozy-muted)] tracking-[0.1em] -mt-1">
        留空表示不限制，由 AI 自行判断（默认 1~3 张）
      </span>

      <div className="cozy-hairline h-px w-full opacity-60" />

      {/* NovelAI 配置 */}
      <SectionHeader icon={<Key size={13} />} title="NovelAI" subtitle="IMAGE_GEN" />

      <InputField
        label="API Key"
        placeholder="pst-..."
        value={cgSettings.novelAI.apiKey}
        onChange={val => onUpdate(prev => ({ ...prev, novelAI: { ...prev.novelAI, apiKey: val } }))}
        type="password"
      />

      <TextAreaField
        label="正向提示词（画风）"
        placeholder="masterpiece, best quality, amazing quality, very aesthetic"
        value={cgSettings.novelAI.positivePrompt}
        onChange={val => onUpdate(prev => ({ ...prev, novelAI: { ...prev.novelAI, positivePrompt: val } }))}
      />
      <TextAreaField
        label="负向提示词"
        placeholder="lowres, bad anatomy, ..."
        value={cgSettings.novelAI.negativePrompt}
        onChange={val => onUpdate(prev => ({ ...prev, novelAI: { ...prev.novelAI, negativePrompt: val } }))}
      />

      {/* 采样参数 */}
      <div className="flex gap-3">
        <InputField
          label="Steps"
          value={String(cgSettings.novelAI.steps ?? 28)}
          onChange={val =>
            onUpdate(prev => ({
              ...prev,
              novelAI: { ...prev.novelAI, steps: parseInt(val) || 28 },
            }))
          }
          type="number"
          className="flex-1"
        />
        <InputField
          label="Guidance"
          value={String(cgSettings.novelAI.scale ?? 6)}
          onChange={val =>
            onUpdate(prev => ({
              ...prev,
              novelAI: { ...prev.novelAI, scale: parseFloat(val) || 6 },
            }))
          }
          type="number"
          className="flex-1"
        />
      </div>

      <div className="cozy-hairline h-px w-full opacity-60" />

      {/* 管理按钮 */}
      <button
        onClick={() => {
          playSfx();
          onClearCache();
        }}
        disabled={isClearingCache}
        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-[color:rgba(186,127,106,0.25)] bg-[rgba(186,127,106,0.06)] text-[var(--color-cozy-muted)] hover:text-[#b86f6f] hover:bg-[rgba(184,111,111,0.08)] hover:border-[color:rgba(184,111,111,0.3)] transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Trash2 size={13} />
        <span className="font-mono-retro text-[10px] tracking-[0.15em]">
          {isClearingCache ? '清理中...' : '🧹 清理所有 CG 缓存'}
        </span>
      </button>
    </>
  );
};

// ====== 角色库 Tab ======
const CharactersTab: React.FC<{
  charAppearances: Record<string, string>;
  isLoading: boolean;
  editingChar: { name: string; tags: string; isNew?: boolean } | null;
  onEdit: (char: { name: string; tags: string; isNew?: boolean } | null) => void;
  onSave: () => void;
  onDelete: (name: string) => void;
  onRefresh: () => void;
  playSfx: () => void;
}> = ({ charAppearances, isLoading, editingChar, onEdit, onSave, onDelete, onRefresh, playSfx }) => (
  <>
    <SectionHeader icon={<Database size={13} />} title="角色外貌库" subtitle="CHARACTER_APPEARANCES" />

    <div className="flex items-center justify-between">
      <span className="font-mono-retro text-[9px] text-[var(--color-cozy-muted)] tracking-[0.15em]">
        {isLoading ? '加载中...' : `${Object.keys(charAppearances).length} 个角色`}
      </span>
      <button
        onClick={() => {
          playSfx();
          onRefresh();
        }}
        disabled={isLoading}
        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-muted)] text-[10px] font-mono-retro hover:text-[var(--color-cozy-ink)] hover:bg-[rgba(255,255,255,0.8)] transition-all duration-200 cursor-pointer disabled:opacity-50"
      >
        <RefreshCw size={10} className={isLoading ? 'animate-spin' : ''} />
        刷新
      </button>
    </div>

    {/* 添加新角色 */}
    {editingChar && editingChar.isNew ? (
      <div className="flex flex-col gap-2 p-3 rounded-xl bg-[rgba(255,255,255,0.3)] border border-[color:rgba(161,132,117,0.12)]">
        <input
          type="text"
          placeholder="角色名（如：白娅）"
          value={editingChar.name}
          onChange={e => onEdit({ name: e.target.value, tags: editingChar.tags, isNew: true })}
          autoFocus
          className="w-full px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-ink)] text-[12px] font-mono-retro placeholder:text-[var(--color-cozy-muted)] placeholder:opacity-50 focus:outline-none focus:border-[var(--color-cozy-accent)] transition-all duration-200"
        />
        <textarea
          placeholder="外貌描述（Danbooru tags，如：1girl, white hair, blue eyes）"
          value={editingChar.tags}
          onChange={e => onEdit({ name: editingChar.name, tags: e.target.value, isNew: true })}
          rows={3}
          className="w-full px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-ink)] text-[11px] font-mono-retro placeholder:text-[var(--color-cozy-muted)] placeholder:opacity-50 focus:outline-none focus:border-[var(--color-cozy-accent)] transition-all duration-200 resize-none"
        />
        <div className="flex gap-2">
          <button
            onClick={onSave}
            className="flex-1 py-1.5 rounded-lg bg-[var(--color-cozy-accent)] text-white text-[10px] font-mono-retro tracking-[0.15em] hover:shadow-[0_2px_8px_rgba(221,184,176,0.4)] transition-all duration-200 cursor-pointer"
          >
            保存
          </button>
          <button
            onClick={() => onEdit(null)}
            className="flex-1 py-1.5 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-muted)] text-[10px] font-mono-retro tracking-[0.15em] hover:text-[var(--color-cozy-ink)] transition-all duration-200 cursor-pointer"
          >
            取消
          </button>
        </div>
      </div>
    ) : null}

    {/* 添加按钮 */}
    {!editingChar && (
      <button
        onClick={() => {
          playSfx();
          onEdit({ name: '', tags: '', isNew: true });
        }}
        className="flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-[color:rgba(161,132,117,0.2)] bg-[rgba(255,255,255,0.2)] text-[var(--color-cozy-muted)] hover:text-[var(--color-cozy-ink)] hover:bg-[rgba(255,255,255,0.5)] transition-all duration-200 cursor-pointer"
      >
        <Plus size={12} />
        <span className="font-mono-retro text-[10px] tracking-[0.15em]">添加角色</span>
      </button>
    )}

    <div className="cozy-hairline h-px w-full opacity-60" />

    {/* 角色列表 */}
    <div className="flex flex-col gap-2 max-h-[260px] overflow-y-auto cozy-scrollbar">
      {Object.keys(charAppearances).length === 0 && !isLoading && (
        <div className="text-center py-4 text-[var(--color-cozy-muted)] font-mono-retro text-[10px] tracking-[0.15em]">
          暂无角色，点击上方按钮添加
        </div>
      )}
      {Object.entries(charAppearances).map(([name, tags]) => (
        <div
          key={name}
          className="flex items-start gap-2 px-3 py-2 rounded-xl bg-[rgba(255,255,255,0.3)] border border-[color:rgba(161,132,117,0.08)] hover:bg-[rgba(255,255,255,0.5)] transition-all duration-200"
        >
          <div className="flex-1 min-w-0">
            <div className="font-serif-sc text-[13px] text-[var(--color-cozy-ink)] font-bold mb-0.5">{name}</div>
            <div
              className="font-mono-retro text-[10px] text-[var(--color-cozy-muted)] tracking-[0.08em] truncate"
              title={tags}
            >
              {tags || '（无描述）'}
            </div>
          </div>
          <div className="flex gap-1 flex-shrink-0">
            <button
              onClick={() => {
                playSfx();
                onEdit({ name, tags });
              }}
              className="w-6 h-6 flex items-center justify-center rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-muted)] hover:text-[var(--color-cozy-ink)] transition-all duration-200 cursor-pointer"
              title="编辑"
            >
              <Pencil size={10} />
            </button>
            <button
              onClick={() => onDelete(name)}
              className="w-6 h-6 flex items-center justify-center rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-muted)] hover:text-[#b86f6f] transition-all duration-200 cursor-pointer"
              title="删除"
            >
              <Trash2 size={10} />
            </button>
          </div>
        </div>
      ))}
    </div>

    {/* 编辑弹窗 */}
    {editingChar && !editingChar.isNew && (
      <div className="flex flex-col gap-2 p-3 rounded-xl bg-[rgba(255,255,255,0.3)] border border-[color:rgba(161,132,117,0.12)]">
        <div className="font-mono-retro text-[10px] text-[var(--color-cozy-muted)] tracking-[0.15em]">
          编辑: {editingChar.name}
        </div>
        <textarea
          value={editingChar.tags}
          onChange={e => onEdit({ ...editingChar, tags: e.target.value })}
          placeholder="外貌描述 tags，逗号分隔"
          rows={3}
          className="w-full px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-ink)] text-[11px] font-mono-retro placeholder:text-[var(--color-cozy-muted)] placeholder:opacity-50 focus:outline-none focus:border-[var(--color-cozy-accent)] transition-all duration-200 resize-none cozy-scrollbar"
        />
        <div className="flex gap-2">
          <button
            onClick={onSave}
            className="flex-1 py-1.5 rounded-lg bg-[var(--color-cozy-accent)] text-white text-[10px] font-mono-retro tracking-[0.15em] hover:shadow-[0_2px_8px_rgba(221,184,176,0.4)] transition-all duration-200 cursor-pointer"
          >
            保存
          </button>
          <button
            onClick={() => onEdit(null)}
            className="flex-1 py-1.5 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-muted)] text-[10px] font-mono-retro tracking-[0.15em] hover:text-[var(--color-cozy-ink)] transition-all duration-200 cursor-pointer"
          >
            取消
          </button>
        </div>
      </div>
    )}

    <span className="font-mono-retro text-[8px] text-[var(--color-cozy-muted)] tracking-[0.2em] opacity-50">
      数据来源: 世界书 [res]角色外貌库
    </span>
  </>
);

// ====== Vibe Tab ======
const VibeTab: React.FC<{
  schemes: VibeScheme[];
  activeSchemeId: string | null;
  onCreateScheme: (name: string) => void;
  onDeleteScheme: (id: string) => void;
  onRenameScheme: (id: string, name: string) => void;
  onSetActiveScheme: (id: string | null) => void;
  onUploadVibe: () => void;
  onRemoveVibe: (schemeId: string, vibeId: string) => void;
  onUpdateVibeParams: (schemeId: string, vibeId: string, params: { infoExtracted?: number; strength?: number }) => void;
  isUploading: boolean;
  playSfx: () => void;
}> = ({
  schemes,
  activeSchemeId,
  onCreateScheme,
  onDeleteScheme,
  onRenameScheme,
  onSetActiveScheme,
  onUploadVibe,
  onRemoveVibe,
  onUpdateVibeParams,
  isUploading,
  playSfx,
}) => {
  const [newSchemeName, setNewSchemeName] = useState('');
  const [editingSchemeId, setEditingSchemeId] = useState<string | null>(null);
  const [editingSchemeName, setEditingSchemeName] = useState('');

  const activeScheme = schemes.find(s => s.id === activeSchemeId);

  return (
    <>
      <SectionHeader icon={<Image size={13} />} title="Vibe 方案" subtitle="VIBE_TRANSFER" />

      {/* 方案选择下拉 */}
      <div className="flex items-center gap-2">
        <select
          value={activeSchemeId ?? ''}
          onChange={e => onSetActiveScheme(e.target.value || null)}
          className="flex-1 px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-ink)] text-[12px] font-mono-retro focus:outline-none focus:border-[var(--color-cozy-accent)] transition-all duration-200 cursor-pointer"
        >
          <option value="">-- 选择方案 --</option>
          {schemes.map(s => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.vibes.length} 个 Vibe)
            </option>
          ))}
        </select>
        {activeSchemeId && editingSchemeId !== activeSchemeId && (
          <button
            onClick={() => {
              playSfx();
              setEditingSchemeId(activeSchemeId);
              setEditingSchemeName(activeScheme?.name ?? '');
            }}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-muted)] hover:text-[var(--color-cozy-ink)] transition-all duration-200 cursor-pointer"
            title="重命名"
          >
            <Pencil size={10} />
          </button>
        )}
        {activeSchemeId && (
          <button
            onClick={() => onDeleteScheme(activeSchemeId)}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-muted)] hover:text-[#b86f6f] transition-all duration-200 cursor-pointer"
            title="删除方案"
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>

      {/* 重命名输入 */}
      {editingSchemeId && editingSchemeId === activeSchemeId && (
        <div className="flex gap-2">
          <input
            type="text"
            value={editingSchemeName}
            onChange={e => setEditingSchemeName(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-ink)] text-[12px] font-mono-retro focus:outline-none focus:border-[var(--color-cozy-accent)] transition-all duration-200"
          />
          <button
            onClick={() => {
              if (editingSchemeName.trim()) {
                onRenameScheme(editingSchemeId, editingSchemeName.trim());
              }
              setEditingSchemeId(null);
            }}
            className="px-3 py-1.5 rounded-lg bg-[var(--color-cozy-accent)] text-white text-[10px] font-mono-retro tracking-[0.15em] cursor-pointer"
          >
            确认
          </button>
          <button
            onClick={() => setEditingSchemeId(null)}
            className="px-3 py-1.5 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-muted)] text-[10px] font-mono-retro cursor-pointer"
          >
            取消
          </button>
        </div>
      )}

      {/* 新建方案 */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newSchemeName}
          onChange={e => setNewSchemeName(e.target.value)}
          placeholder="新方案名称..."
          className="flex-1 px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-ink)] text-[12px] font-mono-retro placeholder:text-[var(--color-cozy-muted)] placeholder:opacity-50 focus:outline-none focus:border-[var(--color-cozy-accent)] transition-all duration-200"
        />
        <button
          onClick={() => {
            if (newSchemeName.trim()) {
              playSfx();
              onCreateScheme(newSchemeName.trim());
              setNewSchemeName('');
            }
          }}
          className="px-3 py-1.5 rounded-lg bg-[var(--color-cozy-accent)] text-white text-[10px] font-mono-retro tracking-[0.15em] hover:shadow-[0_2px_8px_rgba(221,184,176,0.4)] transition-all duration-200 cursor-pointer"
        >
          <Plus size={12} />
        </button>
      </div>

      <div className="cozy-hairline h-px w-full opacity-60" />

      {/* 上传按钮 */}
      {activeScheme && (
        <button
          onClick={onUploadVibe}
          disabled={isUploading}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-dashed border-[color:rgba(161,132,117,0.2)] bg-[rgba(255,255,255,0.2)] text-[var(--color-cozy-muted)] hover:text-[var(--color-cozy-ink)] hover:bg-[rgba(255,255,255,0.5)] transition-all duration-200 cursor-pointer disabled:opacity-50"
        >
          {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          <span className="font-mono-retro text-[10px] tracking-[0.15em]">
            {isUploading ? '导入中...' : '导入 .naiv4vibebundle 方案'}
          </span>
        </button>
      )}

      {/* Vibe 列表 */}
      {activeScheme && (
        <div className="flex flex-col gap-3 max-h-[240px] overflow-y-auto cozy-scrollbar">
          {activeScheme.vibes.length === 0 ? (
            <div className="text-center py-4 text-[var(--color-cozy-muted)] font-mono-retro text-[10px] tracking-[0.15em]">
              暂无 Vibe，点击上方按钮导入
            </div>
          ) : (
            activeScheme.vibes.map(vibe => (
              <div
                key={vibe.id}
                className="flex items-center gap-3 px-3 py-2 rounded-xl bg-[rgba(255,255,255,0.3)] border border-[color:rgba(161,132,117,0.08)] hover:bg-[rgba(255,255,255,0.5)] transition-all duration-200"
              >
                {/* 缩略图 */}
                <div
                  className="w-12 h-12 rounded-lg bg-cover bg-center flex-shrink-0 border border-[color:rgba(161,132,117,0.12)]"
                  style={{ backgroundImage: `url(${vibe.imageBase64})` }}
                />
                <div className="flex-1 min-w-0">
                  <div
                    className="font-mono-retro text-[10px] text-[var(--color-cozy-ink)] tracking-[0.08em] truncate"
                    title={vibe.fileName}
                  >
                    {vibe.fileName}
                  </div>
                  <div className="flex gap-3 mt-1">
                    <div className="flex items-center gap-1">
                      <span className="font-mono-retro text-[8px] text-[var(--color-cozy-muted)]">提取</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={vibe.infoExtracted}
                        onChange={e =>
                          onUpdateVibeParams(activeSchemeId!, vibe.id, { infoExtracted: parseFloat(e.target.value) })
                        }
                        className="w-12 h-1 accent-[var(--color-cozy-accent)]"
                      />
                      <span className="font-mono-retro text-[8px] text-[var(--color-cozy-muted)]">
                        {vibe.infoExtracted.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="font-mono-retro text-[8px] text-[var(--color-cozy-muted)]">强度</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={vibe.strength}
                        onChange={e =>
                          onUpdateVibeParams(activeSchemeId!, vibe.id, { strength: parseFloat(e.target.value) })
                        }
                        className="w-12 h-1 accent-[var(--color-cozy-accent)]"
                      />
                      <span className="font-mono-retro text-[8px] text-[var(--color-cozy-muted)]">
                        {vibe.strength.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => onRemoveVibe(activeSchemeId!, vibe.id)}
                  className="w-6 h-6 flex items-center justify-center rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-muted)] hover:text-[#b86f6f] transition-all duration-200 cursor-pointer flex-shrink-0"
                  title="删除"
                >
                  <X size={10} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
};

// ====== 通用组件 ======

const SectionHeader: React.FC<{ icon: React.ReactNode; title: string; subtitle: string }> = ({
  icon,
  title,
  subtitle,
}) => (
  <div className="flex items-center gap-2 mt-1">
    <div className="text-[var(--color-cozy-accent)] opacity-80">{icon}</div>
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
  className?: string;
}> = ({ label, value, onChange, placeholder, type = 'text', className = '' }) => (
  <div className={`flex flex-col gap-1.5 ${className}`}>
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

const TextAreaField: React.FC<{
  label: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
}> = ({ label, value, onChange, placeholder }) => (
  <div className="flex flex-col gap-1.5">
    <label className="font-mono-retro text-[9px] text-[var(--color-cozy-muted)] tracking-[0.15em] uppercase">
      {label}
    </label>
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={3}
      className="w-full px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.15)] text-[var(--color-cozy-ink)] text-[11px] font-mono-retro placeholder:text-[var(--color-cozy-muted)] placeholder:opacity-50 focus:outline-none focus:border-[var(--color-cozy-accent)] focus:shadow-[0_0_0_2px_rgba(221,184,176,0.2)] transition-all duration-200 resize-none cozy-scrollbar"
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
