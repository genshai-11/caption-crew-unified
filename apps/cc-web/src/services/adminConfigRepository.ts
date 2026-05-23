import { getBytes, ref, uploadString } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import type { VisualTheme } from '@/types';

export interface AdminRuntimeConfig {
  transcriptProvider: 'deepgram' | 'google' | 'thirdparty';
  partialTranscriptEnabled: boolean;
  deepgramApiKey: string;
  captainDeepgramModel: string;
  crewDeepgramModel: string;
  googleApiKey: string;
  googleCloudProjectId: string;
  googleTranscriptModel: string;
  googleTranscriptLocation: string;
  googleOhmModel: string;
  thirdPartyTranscriptUrl: string;
  thirdPartyTranscriptApiKey: string;
  thirdPartyTranscriptModel: string;
  thirdPartyTranscriptAuthScheme: 'none' | 'bearer' | 'x-api-key';
  ohmAnalysisProvider: 'router9';
  thirdPartyOhmUrl: string;
  thirdPartyOhmApiKey: string;
  thirdPartyOhmModel: string;
  thirdPartyOhmAuthScheme: 'none' | 'bearer' | 'x-api-key';
  thirdPartyOhmWebhookUrl: string;
  router9ApiKey: string;
  router9BaseUrl: string;
  router9Model: string;
  router9FallbackModel: string;
  ohmModel: string;
  ohmFallbackModel: string;
  meaningStrictness: 'loose' | 'medium' | 'strict';
  meaningWeight: number;
  feedbackEnabled: boolean;
  feedbackMode: 'gentle' | 'balanced' | 'detailed';
  feedbackTone: 'encouraging' | 'neutral' | 'strict';
  showGrammarReminder: boolean;
  showImprovedSentence: boolean;
  showWhenMeaningCorrect: boolean;
  onlyIfAffectsClarity: boolean;
  visualTheme: VisualTheme;
}

const STORAGE_KEY = 'caption-crew-admin-runtime-config';
const PUBLIC_THEME_STORAGE_KEY = 'caption-crew-public-visual-theme';
const ADMIN_CONFIG_PATH = 'admin-runtime/shared.json';
const PUBLIC_THEME_PATH = 'public-settings/app-theme.json';

export const defaultAdminRuntimeConfig: AdminRuntimeConfig = {
  transcriptProvider: 'deepgram',
  partialTranscriptEnabled: false,
  deepgramApiKey: '',
  captainDeepgramModel: 'nova-3',
  crewDeepgramModel: 'nova-3',
  googleApiKey: '',
  googleCloudProjectId: '',
  googleTranscriptModel: 'chirp_3',
  googleTranscriptLocation: 'global',
  googleOhmModel: 'gemini-1.5-flash',
  thirdPartyTranscriptUrl: 'https://ais-dev-msgfyvxutdkvwq3bz4qbhr-148630698694.asia-southeast1.run.app/api/transcribe',
  thirdPartyTranscriptApiKey: '',
  thirdPartyTranscriptModel: '',
  thirdPartyTranscriptAuthScheme: 'bearer',
  ohmAnalysisProvider: 'router9',
  thirdPartyOhmUrl: 'https://ais-dev-msgfyvxutdkvwq3bz4qbhr-148630698694.asia-southeast1.run.app/api/analyze-ohm',
  thirdPartyOhmApiKey: '',
  thirdPartyOhmModel: '',
  thirdPartyOhmAuthScheme: 'bearer',
  thirdPartyOhmWebhookUrl: '',
  router9ApiKey: '',
  router9BaseUrl: 'https://rqlaeq5.9router.com/v1',
  router9Model: '',
  router9FallbackModel: '',
  ohmModel: '',
  ohmFallbackModel: '',
  meaningStrictness: 'medium',
  meaningWeight: 100,
  feedbackEnabled: true,
  feedbackMode: 'gentle',
  feedbackTone: 'encouraging',
  showGrammarReminder: false,
  showImprovedSentence: false,
  showWhenMeaningCorrect: false,
  onlyIfAffectsClarity: true,
  visualTheme: 'minimal',
};

function normalizeVisualTheme(value?: string | null): VisualTheme {
  return value === 'bold' ? 'bold' : 'minimal';
}

function emitVisualTheme(theme: VisualTheme) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PUBLIC_THEME_STORAGE_KEY, theme);
  window.dispatchEvent(new CustomEvent('thc-visual-theme-change', { detail: theme }));
}

function normalizeAdminConfig(raw?: Partial<AdminRuntimeConfig> | null): AdminRuntimeConfig {
  return {
    ...defaultAdminRuntimeConfig,
    ...(raw || {}),
    transcriptProvider: raw?.transcriptProvider === 'google'
      ? 'google'
      : raw?.transcriptProvider === 'thirdparty'
        ? 'thirdparty'
        : 'deepgram',
    partialTranscriptEnabled: raw?.partialTranscriptEnabled === true,
    visualTheme: normalizeVisualTheme(raw?.visualTheme || defaultAdminRuntimeConfig.visualTheme),
  };
}

async function readJson(path: string) {
  if (!storage) return null;
  try {
    const bytes = await getBytes(ref(storage, path));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error: any) {
    const message = String(error?.message || '');
    const code = String(error?.code || '');
    if (code.includes('storage/object-not-found') || message.includes('Object') || message.includes('No such object')) {
      return null;
    }
    throw error;
  }
}

async function writeJson(path: string, value: unknown, cacheControl: string) {
  if (!storage) return;
  await uploadString(ref(storage, path), JSON.stringify(value, null, 2), 'raw', {
    contentType: 'application/json; charset=utf-8',
    cacheControl,
  });
}

export function loadAdminRuntimeConfig(): AdminRuntimeConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultAdminRuntimeConfig;
    return normalizeAdminConfig(JSON.parse(raw));
  } catch {
    return defaultAdminRuntimeConfig;
  }
}

export function loadCachedVisualTheme(): VisualTheme {
  if (typeof window === 'undefined') return defaultAdminRuntimeConfig.visualTheme;
  return normalizeVisualTheme(localStorage.getItem(PUBLIC_THEME_STORAGE_KEY) || loadAdminRuntimeConfig().visualTheme);
}

export function cacheAdminRuntimeConfig(config: AdminRuntimeConfig) {
  const normalized = normalizeAdminConfig(config);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  emitVisualTheme(normalized.visualTheme);
}

export function saveAdminRuntimeConfig(config: AdminRuntimeConfig) {
  cacheAdminRuntimeConfig(config);
}

export async function loadPublicVisualTheme(): Promise<VisualTheme> {
  const cached = loadCachedVisualTheme();
  try {
    const raw = await readJson(PUBLIC_THEME_PATH) as { visualTheme?: string } | null;
    const theme = normalizeVisualTheme(raw?.visualTheme || cached);
    emitVisualTheme(theme);
    return theme;
  } catch {
    return cached;
  }
}

export async function savePublicVisualTheme(theme: VisualTheme): Promise<VisualTheme> {
  const normalized = normalizeVisualTheme(theme);
  emitVisualTheme(normalized);
  await writeJson(PUBLIC_THEME_PATH, { visualTheme: normalized, updatedAt: new Date().toISOString() }, 'no-cache, no-store, must-revalidate');
  return normalized;
}

export async function loadSharedAdminRuntimeConfig(): Promise<AdminRuntimeConfig> {
  const local = loadAdminRuntimeConfig();
  const publicTheme = await loadPublicVisualTheme();
  const raw = await readJson(ADMIN_CONFIG_PATH) as Partial<AdminRuntimeConfig> | null;
  if (!raw) {
    const mergedLocal = normalizeAdminConfig({ ...local, visualTheme: publicTheme });
    cacheAdminRuntimeConfig(mergedLocal);
    return mergedLocal;
  }

  const merged = normalizeAdminConfig({ ...raw, visualTheme: publicTheme });
  cacheAdminRuntimeConfig(merged);
  return merged;
}

export async function saveSharedAdminRuntimeConfig(config: AdminRuntimeConfig): Promise<AdminRuntimeConfig> {
  const normalized = normalizeAdminConfig(config);
  cacheAdminRuntimeConfig(normalized);
  await writeJson(ADMIN_CONFIG_PATH, { ...normalized, updatedAt: new Date().toISOString() }, 'no-cache, no-store, must-revalidate');
  await savePublicVisualTheme(normalized.visualTheme);
  return normalized;
}

export async function hydrateAdminRuntimeConfigFromCloud() {
  try {
    return await loadSharedAdminRuntimeConfig();
  } catch {
    const local = loadAdminRuntimeConfig();
    const theme = await loadPublicVisualTheme().catch(() => local.visualTheme);
    const merged = normalizeAdminConfig({ ...local, visualTheme: theme });
    cacheAdminRuntimeConfig(merged);
    return merged;
  }
}
