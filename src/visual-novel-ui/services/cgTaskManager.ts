/**
 * CG Task Manager
 * Manages the full async flow: Trigger scan -> LLM analysis -> Progress queue -> NovelAI generation -> Save cache and recipes
 */

import { CG_RECIPES_MVU_KEY, CG_SETTINGS_STORAGE_KEY, DEFAULT_CG_SETTINGS } from '../constants';
import type {
  CGGenerationSettings,
  CGRangeRecipe,
  CGRangeRecipeBundle,
  CGRecipe,
  CGRecipeBundle,
  CGTaskProgress,
  DirectorAnalysisItem,
} from '../types';
import { clearFloorCGCache, deleteCGImage, getCGImage, makeCacheKey, makeRangeCacheKey, putCGImage } from './cgCache';
import { analyzeWithDirectorLLM, analyzeWithDirectorLLMRange } from './directorLLM';
import { generateImage } from './novelAI';
import { getActiveVibesWithImages } from './vibeManager';

// ====== Content Hash ======

/**
 * Compute paragraph text hash - simple fingerprint to determine if floor content changed
 * No need for crypto-level security, just differentiate different content
 */
export function computeContentHash(paragraphs: string[]): string {
  const joined = paragraphs.join('|');
  return `${joined.length}:${joined.slice(0, 100)}:${joined.slice(-100)}`;
}

/** Task progress change callback */
type ProgressCallback = (progress: CGTaskProgress) => void;

/** Global progress listener list */
const progressListeners: Set<ProgressCallback> = new Set();

/** Current task progress */
let currentProgress: CGTaskProgress = { status: 'idle' };

/** Abort flag */
let shouldAbort = false;

/** Current task's AbortController - used to immediately abort network requests */
let currentAbortController: AbortController | null = null;

/** Notify all listeners */
function notifyProgress(progress: CGTaskProgress) {
  currentProgress = progress;
  for (const listener of progressListeners) {
    try {
      listener(progress);
    } catch (e) {
      console.error('[cgTaskManager] Progress callback error:', e);
    }
  }
}

/** Abort current CG generation task */
export function abortCGGeneration(): void {
  if (currentProgress.status === 'analyzing' || currentProgress.status === 'generating') {
    shouldAbort = true;
    // Immediately abort current network request
    if (currentAbortController) {
      currentAbortController.abort();
    }
  }
}

/** Register progress listener */
export function onCGProgress(callback: ProgressCallback): () => void {
  progressListeners.add(callback);
  // Immediately notify current state
  callback(currentProgress);
  return () => progressListeners.delete(callback);
}

/** Get current progress */
export function getCGProgress(): CGTaskProgress {
  return currentProgress;
}

// ====== Settings Management ======

/** Load CG settings from Tavern global variables */
export function loadCGSettings(): CGGenerationSettings {
  try {
    const saved = getVariables({ type: 'global' }) as Record<string, any>;
    const settings = saved?.[CG_SETTINGS_STORAGE_KEY];

    if (settings && typeof settings === 'object') {
      const merged = {
        ...DEFAULT_CG_SETTINGS,
        ...settings,
        directorLLM: { ...DEFAULT_CG_SETTINGS.directorLLM, ...settings.directorLLM },
        novelAI: {
          ...DEFAULT_CG_SETTINGS.novelAI,
          ...settings.novelAI,
          resolution: { ...DEFAULT_CG_SETTINGS.novelAI.resolution, ...settings.novelAI?.resolution },
          // Ensure positivePrompt and negativePrompt are correctly merged
          positivePrompt: settings.novelAI?.positivePrompt ?? DEFAULT_CG_SETTINGS.novelAI.positivePrompt,
          negativePrompt: settings.novelAI?.negativePrompt ?? DEFAULT_CG_SETTINGS.novelAI.negativePrompt,
        },
      };

      return merged;
    }
  } catch (e) {
    console.warn('[cgTaskManager] Failed to load CG settings:', e);
  }

  return { ...DEFAULT_CG_SETTINGS };
}

/** Save CG settings to Tavern global variables */
export function saveCGSettings(settings: CGGenerationSettings): void {
  try {
    const current = (getVariables({ type: 'global' }) as Record<string, any>) || {};
    current[CG_SETTINGS_STORAGE_KEY] = settings;
    replaceVariables(current, { type: 'global' });
  } catch (e) {
    console.error('[cgTaskManager] Failed to save CG settings:', e);
  }
}

// ====== Recipe Management - MVU Variables ======

/** Load CG recipe Bundle from current floor - includes content hash */
export function loadCGRecipeBundle(messageId: number): CGRecipeBundle | null {
  try {
    const vars = getVariables({ type: 'message', message_id: messageId }) as Record<string, any>;
    const stored = vars?.[CG_RECIPES_MVU_KEY];
    if (!stored) return null;
    // Backward compatibility: old format is plain array, upgrade to bundle with empty hash triggers regeneration
    if (Array.isArray(stored)) {
      return { contentHash: '', recipes: stored };
    }
    // New format: CGRecipeBundle object
    if (stored && typeof stored === 'object' && Array.isArray(stored.recipes)) {
      return stored as CGRecipeBundle;
    }
  } catch (e) {
    console.warn('[cgTaskManager] Failed to load CG recipes:', e);
  }
  return null;
}

/** Load CG recipes from current floor - legacy interface */
export function loadCGRecipes(messageId: number): CGRecipe[] {
  const bundle = loadCGRecipeBundle(messageId);
  return bundle?.recipes ?? [];
}

/** Save CG recipe Bundle to current floor */
export function saveCGRecipeBundle(messageId: number, bundle: CGRecipeBundle): void {
  try {
    const vars = (getVariables({ type: 'message', message_id: messageId }) as Record<string, any>) || {};
    vars[CG_RECIPES_MVU_KEY] = bundle;
    replaceVariables(vars, { type: 'message', message_id: messageId });
  } catch (e) {
    console.error('[cgTaskManager] Failed to save CG recipes:', e);
  }
}

/** Save CG recipes to current floor - legacy interface, hash is empty */
export function saveCGRecipes(messageId: number, recipes: CGRecipe[]): void {
  saveCGRecipeBundle(messageId, { contentHash: '', recipes });
}

/** Clear current floor's CG data - recipes + cache */
export async function clearFloorCGData(messageId: number): Promise<void> {
  saveCGRecipes(messageId, []);
  await clearFloorCGCache(messageId);
}

// ====== CG Range Recipe Management ======

const CG_RANGE_RECIPES_MVU_KEY = '__cg_range_recipes__';

/** Load CG range recipe Bundle from current floor */
export function loadCGRangeRecipeBundle(messageId: number): CGRangeRecipeBundle | null {
  try {
    const vars = getVariables({ type: 'message', message_id: messageId }) as Record<string, any>;
    const stored = vars?.[CG_RANGE_RECIPES_MVU_KEY];
    if (stored && typeof stored === 'object' && Array.isArray(stored.ranges)) {
      return stored as CGRangeRecipeBundle;
    }
  } catch (e) {
    console.warn('[cgTaskManager] Failed to load CG range recipes:', e);
  }
  return null;
}

/** Save CG range recipe Bundle to current floor */
export function saveCGRangeRecipeBundle(messageId: number, bundle: CGRangeRecipeBundle): void {
  try {
    const vars = (getVariables({ type: 'message', message_id: messageId }) as Record<string, any>) || {};
    vars[CG_RANGE_RECIPES_MVU_KEY] = bundle;
    replaceVariables(vars, { type: 'message', message_id: messageId });
  } catch (e) {
    console.error('[cgTaskManager] Failed to save CG range recipes:', e);
  }
}

/** Find CG range that contains the paragraph */
export function findCGRangeForParagraph(messageId: number, paragraphIndex: number): CGRangeRecipe | null {
  const bundle = loadCGRangeRecipeBundle(messageId);
  if (!bundle) return null;

  // Find the range containing the paragraph
  for (const range of bundle.ranges) {
    if (paragraphIndex >= range.startIndex && paragraphIndex <= range.endIndex) {
      return range;
    }
  }
  return null;
}

/**
 * ȫCGģʽ�����ҵ�ǰ����Ӧ����ʾ��CG��Χ
 * - ���������ĳ��CG��Χ�ڣ����ظ÷�Χ
 * - ��������κη�Χ�ڣ����������ǰһ��CG��Χ��������ʾ��
 * - ���ǰ��û��CG������null
 */
export function findCGRangeForParagraphFullCoverage(messageId: number, paragraphIndex: number): CGRangeRecipe | null {
  const bundle = loadCGRangeRecipeBundle(messageId);
  if (!bundle || bundle.ranges.length === 0) return null;

  // 1. ���ȼ���Ƿ���ĳ����Χ��
  for (const range of bundle.ranges) {
    if (paragraphIndex >= range.startIndex && paragraphIndex <= range.endIndex) {
      return range;
    }
  }

  // 2. �����κη�Χ�ڣ��������ǰһ��CG��Χ����endIndex����
  const sortedRanges = [...bundle.ranges].sort((a, b) => a.endIndex - b.endIndex);
  
  let lastRange: CGRangeRecipe | null = null;
  for (const range of sortedRanges) {
    if (range.endIndex < paragraphIndex) {
      lastRange = range;
    } else {
      break; // �Ѿ�������ǰ���䣬����Ҫ��������
    }
  }

  return lastRange;
}

/** Recipe regeneration queue: ensures only one NovelAI request at a time */
type RegenerateTask = {
  cacheKey: string;
  messageId: number;
  startIndex: number;
  endIndex: number;
  range: CGRangeRecipe;
  resolve: (url: string | null) => void;
  reject: (error: any) => void;
  priority: 'manual' | 'auto'; // Manual regeneration has higher priority than auto
};
const regenerateQueue: RegenerateTask[] = [];
let isRegenerating = false;
let isManualGenerating = false; // Flag whether manual generation is in progress

/** Process recipe regeneration queue */
async function processRegenerateQueue(): Promise<void> {
  if (isRegenerating || regenerateQueue.length === 0) return;

  // If manual generation is in progress, auto-regeneration needs to wait
  if (isManualGenerating) {
    const hasManualTask = regenerateQueue.some(t => t.priority === 'manual');
    if (!hasManualTask) {
      // No manual tasks in queue, wait for manual generation to complete
      return;
    }
  }

  // Prioritize manual tasks
  const manualTaskIndex = regenerateQueue.findIndex(t => t.priority === 'manual');
  const taskIndex = manualTaskIndex >= 0 ? manualTaskIndex : 0;
  const task = regenerateQueue.splice(taskIndex, 1)[0];

  isRegenerating = true;

  // For auto-regeneration, show progress state
  if (task.priority === 'auto') {
    notifyProgress({
      status: 'generating',
      currentIndex: task.startIndex,
      total: 1,
      completed: 0,
    });
  }

  try {
    const { generateImage } = await import('./novelAI');
    const { getActiveVibesWithImages } = await import('./vibeManager');
    const settings = loadCGSettings();
    const activeVibes = await getActiveVibesWithImages();
    const result = await generateImage(
      task.range.prompt,
      settings.novelAI,
      task.range.seed,
      activeVibes,
      undefined,
      task.range.characters,
    );
    await putCGImage(task.cacheKey, result.base64);
    task.resolve(result.base64);

    // Clear progress after auto-regeneration completes
    if (task.priority === 'auto') {
      notifyProgress({ status: 'idle' });
    }
  } catch (e) {
    console.error(`[cgTaskManager] Recipe regeneration failed:`, e);
    task.reject(e);

    // Clear progress after auto-regeneration fails
    if (task.priority === 'auto') {
      notifyProgress({ status: 'idle' });
    }
  } finally {
    isRegenerating = false;
    // Process next task
    processRegenerateQueue();
  }
}

/** Get CG image for a range - from cache or IndexedDB */
export async function getCGForRange(messageId: number, startIndex: number, endIndex: number): Promise<string | null> {
  const cacheKey = makeRangeCacheKey(messageId, startIndex, endIndex);

  // 1. First check IndexedDB cache
  const cached = await getCGImage(cacheKey);
  if (cached) {
    return cached;
  }

  // 2. Check MVU variables for recipe, default regeneration
  const bundle = loadCGRangeRecipeBundle(messageId);
  if (!bundle) return null;

  const range = bundle.ranges.find(r => r.startIndex === startIndex && r.endIndex === endIndex);
  if (!range) return null;

  // 3. Check if auto-regeneration is enabled
  const settings = loadCGSettings();
  if (!settings.novelAI.apiKey) {
    return null;
  }

  // If user disabled auto-regeneration, return null
  if (settings.autoRegenerate === false) {
    return null;
  }

  // 4. Check if same request already exists in queue
  const existingTask = regenerateQueue.find(
    t => t.messageId === messageId && t.startIndex === startIndex && t.endIndex === endIndex,
  );
  if (existingTask) {
    return new Promise((resolve, reject) => {
      const originalResolve = existingTask.resolve;
      const originalReject = existingTask.reject;
      existingTask.resolve = url => {
        originalResolve(url);
        resolve(url);
      };
      existingTask.reject = error => {
        originalReject(error);
        reject(error);
      };
    });
  }

  // 5. Show lightweight toast notification - mobile friendly
  const totalRanges = bundle.ranges.length;
  const currentRangeIndex = bundle.ranges.findIndex(r => r.startIndex === startIndex && r.endIndex === endIndex);
  const rangeDisplay = currentRangeIndex >= 0 ? `${currentRangeIndex + 1}/${totalRanges}` : `${totalRanges}`;

  if (typeof toastr !== 'undefined') {
    toastr.info(`Restoring CG image (${rangeDisplay})`, '', {
      timeOut: 3000,
      positionClass: 'toast-bottom-center',
      closeButton: false,
      progressBar: true,
    });
  }

  // 6. Add to queue, priority is auto
  return new Promise((resolve, reject) => {
    regenerateQueue.push({
      cacheKey,
      messageId,
      startIndex,
      endIndex,
      range,
      resolve,
      reject,
      priority: 'auto', // Auto-regeneration priority is low
    });
    processRegenerateQueue();
  });
}

/**
 * Trigger CG range generation flow (new version) - one CG covers multiple paragraphs
 * @param paragraphs Current floor's text paragraphs
 * @param messageId Current floor ID
 * @param characterAppearances Character appearance descriptions
 * @param forceRegenerate Force regeneration (ignore hash check)
 * @returns Generated CG range recipes
 */
export async function triggerCGGenerationWithRange(
  paragraphs: string[],
  messageId: number,
  characterAppearances?: Record<string, string>,
  forceRegenerate: boolean = false,
): Promise<CGRangeRecipe[]> {
  // Immediately reset abort flag to prevent previous state from affecting current execution
  shouldAbort = false;
  
  const settings = loadCGSettings();

  if (!settings.enabled) {
    return [];
  }

  if (!settings.directorLLM.endpoint || !settings.directorLLM.apiKey) {
    console.error('[cgTaskManager] Director LLM not configured');
    notifyProgress({ status: 'error', error: 'Director LLM not configured' });
    return [];
  }

  if (!settings.novelAI.apiKey) {
    console.error('[cgTaskManager] NovelAI API Key not configured');
    notifyProgress({ status: 'error', error: 'NovelAI API Key not configured' });
    return [];
  }

  // Content hash comparison: if content unchanged and recipes exist, skip generation (unless forced)
  const currentHash = computeContentHash(paragraphs);
  
  const existingBundle = loadCGRangeRecipeBundle(messageId);

  if (
    !forceRegenerate &&
    existingBundle &&
    existingBundle.contentHash === currentHash &&
    existingBundle.ranges.length > 0
  ) {
    return existingBundle.ranges;
  }

  // If forced regeneration or hash mismatch, delete old data
  // If forced regeneration or hash mismatch, delete old data
  if (existingBundle && existingBundle.ranges.length > 0) {
    // Delete old range cache
    for (const range of existingBundle.ranges) {
      const cacheKey = makeRangeCacheKey(messageId, range.startIndex, range.endIndex);
      await deleteCGImage(cacheKey);
    }
  }

  // Create AbortController to abort network requests
  currentAbortController = new AbortController();
  shouldAbort = false;
  isManualGenerating = true; // Flag manual generation start
  try {
    // Phase 1: Director LLM range analysis
    notifyProgress({ status: 'analyzing' });

    const rangeResults = await analyzeWithDirectorLLMRange(
      paragraphs,
      settings.directorLLM,
      characterAppearances,
      currentAbortController.signal,
      settings.fullCoverageMode ?? false, // ����ȫCGģʽ����
    );

    // Check abort immediately after LLM analysis
    if (shouldAbort) {
      shouldAbort = false;
      notifyProgress({ status: 'idle' });
      if (typeof toastr !== 'undefined') {
        toastr.info('CG generation cancelled', '', { timeOut: 3000 });
      }
      return [];
    }

    if (rangeResults.length === 0) {
      notifyProgress({ status: 'done', total: 0, completed: 0 });
      return [];
    }

    // Phase 2: Generate images for each range one by one
    const ranges: CGRangeRecipe[] = [];
    const total = rangeResults.length;
    
    // Update status to generating to prevent user misoperations
    notifyProgress({
      status: 'generating',
      total,
      completed: 0,
    });

    for (let i = 0; i < rangeResults.length; i++) {
      // Check abort flag
      if (shouldAbort) {
        shouldAbort = false;
        notifyProgress({ status: 'idle' });
        if (typeof toastr !== 'undefined') {
          toastr.info('CG generation cancelled', '', { timeOut: 3000 });
        }
        return ranges;
      }

      const item = rangeResults[i];
      notifyProgress({
        status: 'generating',
        currentIndex: item.startIndex,
        total,
        completed: i, // i ��ʾ����ɵ���������һ������ʱ�����0����
      });

      try {
        // ֱ��ʹ�� LLM ���ɵ� characters���������δ���
        // LLM �Ѿ����� prompt Ҫ�������������� char_caption����ò+����+����+���ߣ�
        const enrichedCharacters = item.characters;
        
        const finalPrompt = item.tags;

        // Get active vibe recipes (async load images)
        const activeVibes = await getActiveVibesWithImages();
        
        const result = await generateImage(
          finalPrompt,
          settings.novelAI,
          undefined,
          activeVibes,
          currentAbortController.signal,
          enrichedCharacters,
        );

        // Save to IndexedDB cache
        const cacheKey = makeRangeCacheKey(messageId, item.startIndex, item.endIndex);
        await putCGImage(cacheKey, result.base64);

        // Record the recipe (including character info) for regeneration
        ranges.push({
          startIndex: item.startIndex,
          endIndex: item.endIndex,
          prompt: finalPrompt,
          characters: enrichedCharacters,
          seed: result.seed,
          reason: item.reason,
        });
      } catch (e: any) {
        const errMsg = e?.message || String(e);
        console.error(`[cgTaskManager] CG range [${i + 1}/${total}] generation failed:`, errMsg);
        
        // For auth errors, directly interrupt entire flow (all subsequent requests will fail)
        if (errMsg.includes('401') || errMsg.includes('Invalid') || errMsg.includes('expired')) {
          notifyProgress({ status: 'error', error: `NovelAI: ${errMsg}` });
          if (typeof toastr !== 'undefined') {
            toastr.error(`NovelAI generation failed: ${errMsg}`, 'CG Generation Error', { timeOut: 8000 });
          }
          return ranges;
        }
        
        // For other errors, show warning but continue (user can see which CG failed)
        if (typeof toastr !== 'undefined') {
          toastr.warning(
            `CG [${i + 1}/${total}] ����ʧ��: ${errMsg.substring(0, 100)}`,
            'CG Generation Warning',
            { timeOut: 5000 }
          );
        }
        
        // Other single failures don't interrupt entire flow
      }
    }

    // Phase 3: Save range recipes to MVU variables, including content hash
    if (ranges.length > 0) {
      saveCGRangeRecipeBundle(messageId, { contentHash: currentHash, ranges });
    }

    // If all images failed, give user a clear error message
    if (ranges.length === 0 && total > 0) {
      notifyProgress({ status: 'error', error: `All ${total} CG ranges generation failed` });
      if (typeof toastr !== 'undefined') {
        toastr.error(`All ${total} CG ranges generation failed. Please check if NovelAI API Key is valid`, 'CG Generation Error', {
          timeOut: 8000,
        });
      }
      return ranges;
    }

    notifyProgress({ status: 'done', total, completed: ranges.length });

    return ranges;
  } catch (e: any) {
    const errorMsg = e?.message || e?.toString?.() || String(e);
    notifyProgress({ status: 'error', error: errorMsg });
    console.error('[cgTaskManager] CG range generation error:', errorMsg, e);
    
    // Use toastr for visible error notification to user
    // Provide more specific error messages for common issues
    let userMessage = errorMsg;
    if (errorMsg.includes('timeout') || errorMsg.includes('��ʱ')) {
      userMessage = `����ʱ: ${errorMsg}�����飺1) ����������� 2) �����ı����� 3) ����API��תվ`;
    } else if (errorMsg.includes('CORS') || errorMsg.includes('Failed to fetch')) {
      userMessage = `��������ʧ��: ${errorMsg}������ԭ��1) CORS�������� 2) API��ַ���ɷ��� 3) ����Ͽ�`;
    } else if (errorMsg.includes('401') || errorMsg.includes('Invalid')) {
      userMessage = `��֤ʧ��: ${errorMsg}������ API Key �Ƿ���ȷ`;
    }
    
    if (typeof toastr !== 'undefined') {
      toastr.error(userMessage, 'CG���ɴ���', { 
        timeOut: 10000,  // �ƶ����û�����������̨����Ҫ��������ʾʱ��
        extendedTimeOut: 5000,
        closeButton: true,
        progressBar: true
      });
    }
    return [];
  } finally {
    currentAbortController = null;
    // Clear manual generation flag
    // After manual generation ends, try to process queued auto-regeneration tasks
    isManualGenerating = false;
    processRegenerateQueue();
  }
}

/**
 * Trigger CG generation flow
 * @param paragraphs Current floor's text paragraphs
 * @param messageId Current floor ID
 * @param characterAppearances Character appearance descriptions
 * @param forceRegenerate Force regeneration (ignore hash check)
 * @returns Generated CG recipes
 */
export async function triggerCGGeneration(
  paragraphs: string[],
  messageId: number,
  characterAppearances?: Record<string, string>,
  forceRegenerate: boolean = false,
): Promise<CGRecipe[]> {
  const settings = loadCGSettings();

  if (!settings.enabled) {
    return [];
  }

  if (!settings.directorLLM.endpoint || !settings.directorLLM.apiKey) {
    notifyProgress({ status: 'error', error: 'Director LLM not configured' });
    return [];
  }

  if (!settings.novelAI.apiKey) {
    notifyProgress({ status: 'error', error: 'NovelAI API Key not configured' });
    return [];
  }

  // Content hash comparison: if content unchanged and recipes exist, skip generation (unless forced)
  const currentHash = computeContentHash(paragraphs);
  const existingBundle = loadCGRecipeBundle(messageId);

  if (
    !forceRegenerate &&
    existingBundle &&
    existingBundle.contentHash === currentHash &&
    existingBundle.recipes.length > 0
  ) {
    return existingBundle.recipes;
  }

  // If forced regeneration or hash mismatch, delete old data
  if (existingBundle && existingBundle.recipes.length > 0) {
    await clearFloorCGData(messageId);
  }

  // Flag manual generation start
  isManualGenerating = true;

  try {
    // Phase 1: Director LLM analysis
    notifyProgress({ status: 'analyzing' });

    const analysisResults: DirectorAnalysisItem[] = await analyzeWithDirectorLLM(
      paragraphs,
      settings.directorLLM,
      characterAppearances,
    );

    if (analysisResults.length === 0) {
      notifyProgress({ status: 'done', total: 0, completed: 0 });
      return [];
    }

    // Phase 2: Generate images one by one
    const recipes: CGRecipe[] = [];
    const total = analysisResults.length;

    for (let i = 0; i < analysisResults.length; i++) {
      const item = analysisResults[i];
      notifyProgress({
        status: 'generating',
        currentIndex: item.paragraphIndex,
        total,
        completed: i,
      });

      try {
        // Director LLM has already seen all character appearances in system prompt
        // Generated tags should only contain scene descriptions, character info handled separately via characters field
        const finalPrompt = item.tags;

        // Get active vibe recipes (async load images)
        const activeVibes = await getActiveVibesWithImages();
        const result = await generateImage(
          finalPrompt,
          settings.novelAI,
          undefined,
          activeVibes,
          undefined,
          item.characters,
        );

        // Save to IndexedDB cache
        const cacheKey = makeCacheKey(messageId, item.paragraphIndex);
        await putCGImage(cacheKey, result.base64);

        // Record recipe
        recipes.push({
          paragraphIndex: item.paragraphIndex,
          prompt: finalPrompt,
          seed: result.seed,
        });
      } catch (e: any) {
        const errMsg = e?.message || String(e);
        console.error(`[cgTaskManager] CG [${i + 1}/${total}] generation failed:`, errMsg);
        // For auth errors, directly interrupt entire flow (all subsequent requests will fail)
        if (errMsg.includes('401') || errMsg.includes('Invalid') || errMsg.includes('expired')) {
          notifyProgress({ status: 'error', error: `NovelAI: ${errMsg}` });
          if (typeof toastr !== 'undefined') {
            toastr.error(`NovelAI generation failed: ${errMsg}`, 'CG Generation Error', { timeOut: 8000 });
          }
          return recipes;
        }
        // Other single failures don't interrupt entire flow
      }
    }

    // Phase 3: Save recipes to MVU variables (including content hash)
    if (recipes.length > 0) {
      saveCGRecipeBundle(messageId, { contentHash: currentHash, recipes });
    }

    // If all images failed, give user a clear error message
    if (recipes.length === 0 && total > 0) {
      notifyProgress({ status: 'error', error: `All ${total} CG generations failed` });
      if (typeof toastr !== 'undefined') {
        toastr.error(`All ${total} CG generations failed. Please check if NovelAI API Key is valid`, 'CG Generation Error', {
          timeOut: 8000,
        });
      }
      return recipes;
    }

    notifyProgress({ status: 'done', total, completed: recipes.length });

    return recipes;
  } catch (e: any) {
    const errorMsg = e?.message || e?.toString?.() || String(e);
    notifyProgress({ status: 'error', error: errorMsg });
    console.error('[cgTaskManager] CG generation flow error:', errorMsg, e);
    // Use toastr for visible error notification to user
    if (typeof toastr !== 'undefined') {
      toastr.error(`CG generation failed: ${errorMsg}`, 'CG Generation Error', { timeOut: 5000 });
    }
    return [];
  } finally {
    // Flag manual generation end
    isManualGenerating = false;
    // After manual generation ends, try to process queued auto-regeneration tasks
    processRegenerateQueue();
  }
}

/**
 * Get CG prompt for a paragraph - for regeneration
 */
export function getCGPromptForParagraph(messageId: number, paragraphIndex: number): string | null {
  try {
    const bundle = loadCGRecipeBundle(messageId);
    if (!bundle) return null;
    const recipe = bundle.recipes.find(r => r.paragraphIndex === paragraphIndex);
    return recipe?.prompt ?? null;
  } catch (e) {
    console.error('[cgTaskManager] Failed to get CG prompt:', e);
    return null;
  }
}

/**
 * Get CG image for a paragraph - from cache or IndexedDB
 */
export async function getCGForParagraph(messageId: number, paragraphIndex: number): Promise<string | null> {
  const cacheKey = makeCacheKey(messageId, paragraphIndex);

  // 1. First check IndexedDB cache
  const cached = await getCGImage(cacheKey);
  if (cached) {
    return cached;
  }

  // 2. Check MVU variables for recipe, if recipe exists, silently regenerate
  const recipes = loadCGRecipes(messageId);
  const recipe = recipes.find(r => r.paragraphIndex === paragraphIndex);

  if (!recipe) {
    return null;
  }

  // 3. Use recipe to regenerate
  const settings = loadCGSettings();
  if (!settings.novelAI.apiKey) {
    return null;
  }

  try {
    const result = await generateImage(recipe.prompt, settings.novelAI, recipe.seed);
    await putCGImage(cacheKey, result.base64);
    return result.base64;
  } catch (e) {
    console.error(`[cgTaskManager] Recipe regeneration failed:`, e);
    return null;
  }
}

