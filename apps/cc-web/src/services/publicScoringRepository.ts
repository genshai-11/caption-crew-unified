import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface PublicScoringSettings {
  crewWinThreshold: number; // 0-100
  targetPoints: number; // 1-20
  mseCoefficient: number; // CCI = LLM meaning % x MSE
  cvrTargetRawUnits: number; // raw CVR units that map to 100 for UI comparison
}

const SCORING_DOC = ['game_settings', 'scoring'] as const;
const STORAGE_KEY = 'caption-crew-public-scoring-v1';

export const defaultPublicScoringSettings: PublicScoringSettings = {
  crewWinThreshold: 50,
  targetPoints: 3,
  mseCoefficient: 1,
  cvrTargetRawUnits: 120,
};

function clampInt(value: any, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function clampNumber(value: any, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalize(raw?: Partial<PublicScoringSettings> | null): PublicScoringSettings {
  return {
    crewWinThreshold: clampInt(raw?.crewWinThreshold, 0, 100, defaultPublicScoringSettings.crewWinThreshold),
    targetPoints: clampInt(raw?.targetPoints, 1, 20, defaultPublicScoringSettings.targetPoints),
    mseCoefficient: clampNumber(raw?.mseCoefficient, 0, 5, defaultPublicScoringSettings.mseCoefficient),
    cvrTargetRawUnits: clampNumber(raw?.cvrTargetRawUnits, 1, 1000, defaultPublicScoringSettings.cvrTargetRawUnits),
  };
}

function cache(settings: PublicScoringSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export function loadCachedPublicScoringSettings(): PublicScoringSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPublicScoringSettings;
    return normalize(JSON.parse(raw));
  } catch {
    return defaultPublicScoringSettings;
  }
}

export async function loadPublicScoringSettings(): Promise<PublicScoringSettings> {
  const cached = loadCachedPublicScoringSettings();
  if (!db) return cached;
  try {
    const snap = await getDoc(doc(db, ...SCORING_DOC));
    if (!snap.exists()) {
      cache(cached);
      return cached;
    }
    const settings = normalize(snap.data() as any);
    cache(settings);
    return settings;
  } catch {
    return cached;
  }
}

export async function savePublicScoringSettings(settings: PublicScoringSettings) {
  const normalized = normalize(settings);
  cache(normalized);
  if (db) {
    await setDoc(doc(db, ...SCORING_DOC), { ...normalized, updatedAt: new Date().toISOString() }, { merge: true });
  }
  return normalized;
}

export function subscribePublicScoringSettings(onValue: (settings: PublicScoringSettings) => void, onError?: (err: any) => void) {
  const cached = loadCachedPublicScoringSettings();
  onValue(cached);
  if (!db) return () => undefined;

  return onSnapshot(
    doc(db, ...SCORING_DOC),
    (snap) => {
      const settings = snap.exists() ? normalize(snap.data() as any) : cached;
      cache(settings);
      onValue(settings);
    },
    (err) => {
      onError?.(err);
      onValue(cached);
    }
  );
}
