import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface PublicScoringSettings {
  crewWinThreshold: number;     // 0-100: CPD threshold for crew to win a round
  targetPoints: number;         // 1-20: points needed to win the match
  mseCoefficient: number;       // CCI MSE multiplier (default 1, evaluator-entered)
  cvrTargetRawUnits: number;    // raw CVR units that map to 100 for UI comparison
  // Team faceoff settings
  teamMode: boolean;            // enable team roster mode (dynamic size)
  cvrMinVolt: number;           // min valid CVR voltage — below this = too easy → crew auto-wins
  cvrMaxVolt: number;           // max valid CVR voltage — above this = out of range → crew auto-wins
  enablePerfectCrewBonus: boolean; // 100% semantic + MSE ≥1 → crew auto-wins
  swapAfterRound: boolean;      // swap Captain/Crew team roles after each round
  maxTeamSize: number;          // max players per team slot (dynamic, 1–50)
}

const SCORING_DOC = ['game_settings', 'scoring'] as const;
const STORAGE_KEY = 'caption-crew-public-scoring-v1';

export const defaultPublicScoringSettings: PublicScoringSettings = {
  crewWinThreshold: 50,
  targetPoints: 3,
  mseCoefficient: 1,
  cvrTargetRawUnits: 120,
  teamMode: false,
  cvrMinVolt: 1,
  cvrMaxVolt: 50,
  enablePerfectCrewBonus: true,
  swapAfterRound: false,
  maxTeamSize: 10,
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
    mseCoefficient: clampNumber(raw?.mseCoefficient, 0, 10, defaultPublicScoringSettings.mseCoefficient),
    cvrTargetRawUnits: clampNumber(raw?.cvrTargetRawUnits, 1, 1000, defaultPublicScoringSettings.cvrTargetRawUnits),
    teamMode: Boolean(raw?.teamMode ?? defaultPublicScoringSettings.teamMode),
    cvrMinVolt: clampNumber(raw?.cvrMinVolt, 0, 999, defaultPublicScoringSettings.cvrMinVolt),
    cvrMaxVolt: clampNumber(raw?.cvrMaxVolt, 1, 9999, defaultPublicScoringSettings.cvrMaxVolt),
    enablePerfectCrewBonus: Boolean(raw?.enablePerfectCrewBonus ?? defaultPublicScoringSettings.enablePerfectCrewBonus),
    swapAfterRound: Boolean(raw?.swapAfterRound ?? defaultPublicScoringSettings.swapAfterRound),
    maxTeamSize: clampInt(raw?.maxTeamSize, 1, 50, defaultPublicScoringSettings.maxTeamSize),
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
