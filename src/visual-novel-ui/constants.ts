import { CGGenerationSettings, CharacterProfile, ResourceConfig } from './types';

export const AUDIO_ASSETS = {
  // Fill these with your own audio links
  bgm: '',
  click: '',
};

export const VISUAL_ASSETS = {
  // Fill this with a texture image URL (e.g., scratches, grunge)
  noiseOverlay: '',
};

export const SAMPLE_CHARACTER: CharacterProfile = {
  id: 'char_001',
  name: '',
  codeName: 'SUBJECT-???',
  description: '身份不明的幸存者。',
  avatarUrl: '',
  vitals: {
    identity: '未设定',
    load: { current: 0, max: 15 },
    trauma: '健康',
    temperature: 36.5,
    antibody: 'F',
  },
  attributes: {
    strength: 0,
    agility: 0,
    endurance: 0,
  },
  skills: {},
  inventory: {},
  relationships: {
    付觉晓: { 信任值: 0 },
    白河凛: { 归属感: 0 },
    沈栖: { 安全感: 0 },
  },
};

/**
 * 资源映射配置
 * 在此填入角色立绘、背景图、BGM 的实际 URL
 */
export const RESOURCE_CONFIG: ResourceConfig = {
  characters: {},
  backgrounds: {},
  bgm: {},
  cg: {},
  characterAppearances: {},
  voices: {
    enabled: false,
    autoPlay: true,
    preloadEnabled: false,
    apiKey: '',
    model: 'mimo-v2.5-tts-voiceclone',
    characterVoices: {},
    enableEmotionTags: false,
    emotionTagLLM: {
      endpoint: '',
      apiKey: '',
      model: '',
    },
  },
};

/** CG 生成设置默认值 */
export const DEFAULT_CG_SETTINGS: CGGenerationSettings = {
  directorLLM: {
    endpoint: '',
    apiKey: '',
    model: '',
  },
  novelAI: {
    apiKey: '',
    model: 'nai-diffusion-4-5-full',
    positivePrompt: 'masterpiece, best quality, amazing quality, very aesthetic, absurdres, highres',
    negativePrompt:
      'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry',
    resolution: { width: 1216, height: 832 },
    sampler: 'k_euler',
    steps: 28,
    scale: 5,
  },
  enabled: false,
  fullCoverageMode: false,
  preloadEnabled: false,
};

/** CG 设置在酒馆全局变量中的存储 key */
export const CG_SETTINGS_STORAGE_KEY = 'quiet_editor_cg_settings';

/** CG 配方在楼层 MVU 变量中的存储 key */
export const CG_RECIPES_MVU_KEY = 'cg_recipes';

/** Vibe 方案在酒馆全局变量中的存储 key */
export const VIBE_STORAGE_KEY = 'quiet_editor_vibe_schemes';
