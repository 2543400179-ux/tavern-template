// ====== 视图类型 ======

/** 界面视图枚举 */
export type ScreenView = 'GAME' | 'SETTINGS' | 'SAVE_LOAD' | 'LOG' | 'COLLECTION' | 'CG_CONFIG';

// ====== 游戏设置 ======

/** 游戏设置 */
export interface GameSettings {
  /** 打字机速度（字符/秒） */
  typewriterSpeed: number;
  /** 自动播放开关 */
  autoPlay: boolean;
  /** 自动播放延迟（毫秒） */
  autoPlayDelay: number;
  /** BGM 音量 (0-1) */
  bgmVolume: number;
  /** 音效音量 (0-1) */
  sfxVolume: number;
  /** 语音音量 (0-1) */
  voiceVolume: number;
  /** 文本显示速度 */
  textSpeed: number;
  /** 启用粒子效果 */
  particlesEnabled: boolean;
  /** 启用屏幕震动 */
  screenShakeEnabled: boolean;
}

// ====== 角色数据 ======

/** 角色档案 */
export interface CharacterProfile {
  id: string;
  name: string;
  codeName: string;
  description: string;
  avatarUrl: string;
  vitals: {
    identity: string;
    load: { current: number; max: number };
    trauma: string;
    temperature: number;
    antibody: string;
  };
  attributes: {
    strength: number;
    agility: number;
    endurance: number;
  };
  skills: Record<string, any>;
  inventory: Record<string, any>;
  relationships?: {
    付觉?: { 信任度?: number };
    白河?: { 归属感?: number };
    沈栖?: { 安全感?: number };
    [key: string]: any;
  };
}

// ====== 对话解析相关 ======

/** 威胁等级 */
export type ThreatLevel = '低' | '中' | '高' | '极高';

/** 背景世界状态（由 [bg:] 指令驱动） */
export interface BgWorldState {
  场景: string;
  威胁度等级: ThreatLevel | string;
  时间: string;
}

/** 段落效果（指令解析结果） */
export interface SegmentEffects {
  char?: string;
  face?: string;
  bg?: string;
  bgm?: string;
  cg?: string;
  desc?: string;
  about?: string;
  /** [bg:场景|威胁度|时间] 解析结果 */
  bgWorld?: BgWorldState;
  /** [stat:path|value|mode] 段落级状态覆盖 */
  statOverrides?: StatOverride[];
}

/** 段落级状态覆盖（[stat:] 指令） */
export interface StatOverride {
  path: string;
  value: string;
  mode?: 'set' | 'append';
}

/** 对话选项 */
export interface DialogueOption {
  text: string;
  next?: string;
}

/** Skit 台词 */
export interface SkitLine {
  char: string;
  face?: string;
  text: string;
}

/** 对话段落 */
export interface DialogueSegment {
  id: string;
  speaker: string;
  text: string;
  effects: SegmentEffects;
  options?: DialogueOption[];
  skit?: SkitLine[];
  voice?: string;
}

/** 解析后的脚本 */
export interface ParsedScript {
  segments: DialogueSegment[];
}

/** 完整背景状态（包含图片和模糊度） */
export interface BgFullState {
  url: string;
  blur: number;
}

// ====== 资源配置 ======

/** 资源映射配置 */
export interface ResourceConfig {
  /** 角色立绘映射：{ "角色名": { "表情": "URL" } } */
  characters: Record<string, Record<string, string>>;
  /** 背景图映射：{ "背景名": "URL" } */
  backgrounds: Record<string, string>;
  /** BGM 映射：{ "BGM名": "URL" } */
  bgm: Record<string, string>;
  /** CG 映射：{ "CG名": "URL" } */
  cg: Record<string, string>;
  /** 角色外观描述映射（用于 AI 生成 CG）：{ "角色名": "外观描述" } */
  characterAppearances: Record<string, string>;
  /** 语音配置 */
  voices?: VoiceConfig;
}

/** 角色语音设置 */
export interface CharacterVoiceSettings {
  /** 音色 URL、Base64 或预置音色 ID */
  voice: string;
  /** 音量 0-1 */
  volume: number;
  /** 风格提示词（可选） */
  stylePrompt?: string;
  /** 角色信息（用于情绪标签 LLM，可选） */
  characterInfo?: string;
}

/** 语音配置 */
export interface VoiceConfig {
  /** 是否启用语音 */
  enabled: boolean;
  /** 是否自动播放 */
  autoPlay: boolean;
  /** 是否启用预加载 */
  preloadEnabled?: boolean;
  /** MiMo API Key */
  apiKey: string;
  /** MiMo 模型 */
  model: string;
  /** 角色名 -> 语音设置映射 */
  characterVoices: Record<string, CharacterVoiceSettings>;
  
  /** 是否启用情绪标签 */
  enableEmotionTags?: boolean;
  /** 情绪标签 LLM 配置 */
  emotionTagLLM?: {
    endpoint: string;
    apiKey: string;
    model: string;
  };
}

// ====== 收藏条目 ======

/** 收藏条目（回想模式） */
export interface CollectionEntry {
  id: string;
  title: string;
  thumbnail?: string;
  messageId: number;
  timestamp: number;
  tags?: string[];
}

// ====== CG 生成相关 ======

/** Director LLM 配置 */
export interface DirectorLLMConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

/** NovelAI 配置 */
export interface NovelAIConfig {
  apiKey: string;
  model: string;
  positivePrompt: string;
  negativePrompt: string;
  resolution: { width: number; height: number };
  sampler: string;
  steps: number;
  scale: number;
}

/** CG 生成设置 */
export interface CGGenerationSettings {
  directorLLM: DirectorLLMConfig;
  novelAI: NovelAIConfig;
  enabled: boolean;
  fullCoverageMode: boolean;
  preloadEnabled?: boolean;
}

/** CG 配方（单段落） */
export interface CGRecipe {
  paragraphIndex: number;
  prompt: string;
  vibeImageKey?: string;
}

/** CG 配方包（单楼层多段落） */
export interface CGRecipeBundle {
  messageId: number;
  recipes: CGRecipe[];
}

/** CG 范围配方（多段落合并生成一张） */
export interface CGRangeRecipe {
  startIndex: number;
  endIndex: number;
  prompt: string;
  vibeImageKey?: string;
}

/** CG 范围配方包 */
export interface CGRangeRecipeBundle {
  messageId: number;
  rangeRecipes: CGRangeRecipe[];
}

/** CG 生成任务进度 */
export interface CGTaskProgress {
  messageId: number;
  total: number;
  completed: number;
  failed: number;
  status: 'pending' | 'running' | 'done' | 'error';
}

/** Director 分析项（单段落） */
export interface DirectorAnalysisItem {
  paragraphIndex: number;
  action: string;
  sentiment: string;
  context: string;
}

/** Director 分析项（范围） */
export interface DirectorAnalysisRangeItem {
  startIndex: number;
  endIndex: number;
  action: string;
  sentiment: string;
  context: string;
}

// ====== Vibe Transfer 相关 ======

/** Vibe 条目 */
export interface VibeEntry {
  id: string;
  name: string;
  imageKey: string;
  createdAt: number;
}

/** Vibe 方案 */
export interface VibeScheme {
  id: string;
  name: string;
  entries: VibeEntry[];
  createdAt: number;
  updatedAt: number;
}

/** Vibe 存储 */
export interface VibeStorage {
  schemes: VibeScheme[];
  activeSchemeId: string | null;
}
