import { getBytes, ref, uploadString } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import type { VisualTheme } from '@/types';
import type { SemanticRuleOverrides } from '@/lib/ohmCalculator';

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
  ohmWeights: {
    GREEN: number;
    BLUE: number;
    RED: number;
    PINK: number;
  };
  ohmLengthConstraints: {
    veryShort: { maxSentences: number; maxWords: number };
    short: { maxSentences: number; maxWords: number };
    medium: { maxSentences: number; maxWords: number };
    long: { maxSentences: number; maxWords: number };
  };
  ohmLengthCoefficients: {
    veryShort: number;
    short: number;
    medium: number;
    long: number;
    overLong: number;
  };
  ohmAgentEnabled: boolean;
  ohmAgentEndpoint: string;
  ohmAgentApiKey: string;
  ohmAgentAuthScheme: 'none' | 'bearer' | 'x-api-key';
  ohmAgentTimeoutMs: number;
  ohmAgentShadowMode: boolean;
  ohmResponseTiming: {
    fullScoreMs: number;
    minScoreMs: number;
    minCoefficient: number;
  };
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
  semanticOhmCurrent: number;
  semanticRuleOverrides: SemanticRuleOverrides;
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
  router9BaseUrl: 'http://34.87.121.108:20128/v1',
  router9Model: 'gpt',
  router9FallbackModel: 'gpt',
  ohmModel: 'gpt',
  ohmFallbackModel: 'gpt',
  ohmWeights: {
    GREEN: 5,
    BLUE: 7,
    RED: 9,
    PINK: 3,
  },
  ohmLengthConstraints: {
    veryShort: { maxSentences: 1, maxWords: 25 },
    short: { maxSentences: 2, maxWords: 35 },
    medium: { maxSentences: 3, maxWords: 60 },
    long: { maxSentences: 5, maxWords: 110 },
  },
  ohmLengthCoefficients: {
    veryShort: 1,
    short: 1.5,
    medium: 2,
    long: 2.5,
    overLong: 2.5,
  },
  ohmAgentEnabled: false,
  ohmAgentEndpoint: '',
  ohmAgentApiKey: '',
  ohmAgentAuthScheme: 'bearer',
  ohmAgentTimeoutMs: 9000,
  ohmAgentShadowMode: true,
  ohmResponseTiming: {
    fullScoreMs: 2000,
    minScoreMs: 5000,
    minCoefficient: 0.333333,
  },
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
  semanticOhmCurrent: 1.0,
  semanticRuleOverrides: {
    GREEN: [],
    BLUE: [],
    RED: [],
    PINK: [],
  },
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
    ohmAnalysisProvider: 'router9',
    thirdPartyTranscriptAuthScheme: raw?.thirdPartyTranscriptAuthScheme === 'none'
      ? 'none'
      : raw?.thirdPartyTranscriptAuthScheme === 'x-api-key'
        ? 'x-api-key'
        : 'bearer',
    thirdPartyOhmAuthScheme: raw?.thirdPartyOhmAuthScheme === 'none'
      ? 'none'
      : raw?.thirdPartyOhmAuthScheme === 'x-api-key'
        ? 'x-api-key'
        : 'bearer',
    ohmAgentAuthScheme: raw?.ohmAgentAuthScheme === 'none'
      ? 'none'
      : raw?.ohmAgentAuthScheme === 'x-api-key'
        ? 'x-api-key'
        : 'bearer',
    ohmAgentEnabled: raw?.ohmAgentEnabled === true,
    ohmAgentEndpoint: String(raw?.ohmAgentEndpoint || defaultAdminRuntimeConfig.ohmAgentEndpoint),
    ohmAgentApiKey: String(raw?.ohmAgentApiKey || defaultAdminRuntimeConfig.ohmAgentApiKey),
    ohmAgentTimeoutMs: Number(raw?.ohmAgentTimeoutMs || defaultAdminRuntimeConfig.ohmAgentTimeoutMs),
    ohmAgentShadowMode: raw?.ohmAgentShadowMode !== false,
    ohmResponseTiming: {
      fullScoreMs: Number(raw?.ohmResponseTiming?.fullScoreMs || defaultAdminRuntimeConfig.ohmResponseTiming.fullScoreMs),
      minScoreMs: Number(raw?.ohmResponseTiming?.minScoreMs || defaultAdminRuntimeConfig.ohmResponseTiming.minScoreMs),
      minCoefficient: Number(raw?.ohmResponseTiming?.minCoefficient || defaultAdminRuntimeConfig.ohmResponseTiming.minCoefficient),
    },
    visualTheme: normalizeVisualTheme(raw?.visualTheme || defaultAdminRuntimeConfig.visualTheme),
    semanticOhmCurrent: Number(raw?.semanticOhmCurrent || defaultAdminRuntimeConfig.semanticOhmCurrent),
    ohmModel: String(raw?.ohmModel || raw?.router9Model || defaultAdminRuntimeConfig.ohmModel),
    ohmFallbackModel: String(raw?.ohmFallbackModel || raw?.router9FallbackModel || defaultAdminRuntimeConfig.ohmFallbackModel),
    ohmWeights: {
      GREEN: Number(raw?.ohmWeights?.GREEN || defaultAdminRuntimeConfig.ohmWeights.GREEN),
      BLUE: Number(raw?.ohmWeights?.BLUE || defaultAdminRuntimeConfig.ohmWeights.BLUE),
      RED: Number(raw?.ohmWeights?.RED || defaultAdminRuntimeConfig.ohmWeights.RED),
      PINK: Number(raw?.ohmWeights?.PINK || defaultAdminRuntimeConfig.ohmWeights.PINK),
    },
    ohmLengthConstraints: {
      veryShort: {
        maxSentences: Number(raw?.ohmLengthConstraints?.veryShort?.maxSentences || defaultAdminRuntimeConfig.ohmLengthConstraints.veryShort.maxSentences),
        maxWords: Number(raw?.ohmLengthConstraints?.veryShort?.maxWords || defaultAdminRuntimeConfig.ohmLengthConstraints.veryShort.maxWords),
      },
      short: {
        maxSentences: Number(raw?.ohmLengthConstraints?.short?.maxSentences || defaultAdminRuntimeConfig.ohmLengthConstraints.short.maxSentences),
        maxWords: Number(raw?.ohmLengthConstraints?.short?.maxWords || defaultAdminRuntimeConfig.ohmLengthConstraints.short.maxWords),
      },
      medium: {
        maxSentences: Number(raw?.ohmLengthConstraints?.medium?.maxSentences || defaultAdminRuntimeConfig.ohmLengthConstraints.medium.maxSentences),
        maxWords: Number(raw?.ohmLengthConstraints?.medium?.maxWords || defaultAdminRuntimeConfig.ohmLengthConstraints.medium.maxWords),
      },
      long: {
        maxSentences: Number(raw?.ohmLengthConstraints?.long?.maxSentences || defaultAdminRuntimeConfig.ohmLengthConstraints.long.maxSentences),
        maxWords: Number(raw?.ohmLengthConstraints?.long?.maxWords || defaultAdminRuntimeConfig.ohmLengthConstraints.long.maxWords),
      },
    },
    ohmLengthCoefficients: {
      veryShort: Number(raw?.ohmLengthCoefficients?.veryShort || defaultAdminRuntimeConfig.ohmLengthCoefficients.veryShort),
      short: Number(raw?.ohmLengthCoefficients?.short || defaultAdminRuntimeConfig.ohmLengthCoefficients.short),
      medium: Number(raw?.ohmLengthCoefficients?.medium || defaultAdminRuntimeConfig.ohmLengthCoefficients.medium),
      long: Number(raw?.ohmLengthCoefficients?.long || defaultAdminRuntimeConfig.ohmLengthCoefficients.long),
      overLong: Number(raw?.ohmLengthCoefficients?.overLong || defaultAdminRuntimeConfig.ohmLengthCoefficients.overLong),
    },
    semanticRuleOverrides: {
      GREEN: Array.isArray(raw?.semanticRuleOverrides?.GREEN) ? raw?.semanticRuleOverrides?.GREEN : defaultAdminRuntimeConfig.semanticRuleOverrides.GREEN,
      BLUE: Array.isArray(raw?.semanticRuleOverrides?.BLUE) ? raw?.semanticRuleOverrides?.BLUE : defaultAdminRuntimeConfig.semanticRuleOverrides.BLUE,
      RED: Array.isArray(raw?.semanticRuleOverrides?.RED) ? raw?.semanticRuleOverrides?.RED : defaultAdminRuntimeConfig.semanticRuleOverrides.RED,
      PINK: Array.isArray(raw?.semanticRuleOverrides?.PINK) ? raw?.semanticRuleOverrides?.PINK : defaultAdminRuntimeConfig.semanticRuleOverrides.PINK,
    },
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
