import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { GameSettings, RoundRecord } from '@/types';

const SETTINGS_KEY = 'caption-crew-settings';
const HISTORY_KEY = 'caption-crew-history';

export const defaultGameSettings: GameSettings = {
  maxCrewStartDelayMs: 3000,
  strictness: 'medium',
  showCountdown: true,
};

function normalizeRound(round: Partial<RoundRecord>): RoundRecord {
  return {
    id: String(round.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    createdAt: String(round.createdAt || new Date().toISOString()),
    state: (round.state || 'results') as RoundRecord['state'],
    captainPlayerId: round.captainPlayerId ?? null,
    crewPlayerId: round.crewPlayerId ?? null,
    captainName: round.captainName ?? null,
    crewName: round.crewName ?? null,
    captainTranscript: round.captainTranscript,
    crewTranscript: round.crewTranscript,
    captainVerifiedTranscript: round.captainVerifiedTranscript,
    crewVerifiedTranscript: round.crewVerifiedTranscript,
    ohmResult: round.ohmResult
      ? {
          totalOhm: Number(round.ohmResult.totalOhm || 0),
          formula: String(round.ohmResult.formula || '0'),
          voltage: Number(round.ohmResult.voltage || 0),
          current: Number(round.ohmResult.current || 0),
          difficulty: String(round.ohmResult.difficulty || 'Beginner'),
          score: Number(round.ohmResult.score || 0),
          chunkCount: Number(round.ohmResult.chunkCount || 0),
          baseOhm: typeof round.ohmResult.baseOhm === 'number' ? round.ohmResult.baseOhm : undefined,
          estimatedTC: typeof round.ohmResult.estimatedTC === 'number' ? round.ohmResult.estimatedTC : undefined,
          confirmedTC: typeof round.ohmResult.confirmedTC === 'number' ? round.ohmResult.confirmedTC : undefined,
          candidateTC: typeof round.ohmResult.candidateTC === 'number' ? round.ohmResult.candidateTC : undefined,
          linguisticComplexity: typeof round.ohmResult.linguisticComplexity === 'number' ? round.ohmResult.linguisticComplexity : undefined,
          tensionLoad: typeof round.ohmResult.tensionLoad === 'number' ? round.ohmResult.tensionLoad : undefined,
          responseCoefficient: typeof round.ohmResult.responseCoefficient === 'number' ? round.ohmResult.responseCoefficient : undefined,
          repeatCoefficient: typeof round.ohmResult.repeatCoefficient === 'number' ? round.ohmResult.repeatCoefficient : undefined,
          chunks: Array.isArray(round.ohmResult.chunks)
            ? round.ohmResult.chunks.map((chunk) => {
                const label = ['GREEN', 'BLUE', 'RED', 'PINK'].includes(String(chunk.label))
                  ? (String(chunk.label) as 'GREEN' | 'BLUE' | 'RED' | 'PINK')
                  : 'PINK';
                return {
                  text: String(chunk.text || ''),
                  label,
                  ohm: Number(chunk.ohm || 0),
                };
              })
            : [],
        }
      : undefined,
    metrics: round.metrics,
    evaluation: round.evaluation,
    reactionDelayMs: typeof round.reactionDelayMs === 'number' ? round.reactionDelayMs : undefined,
    timeoutLost: round.timeoutLost === true,
    captainAudioUrl: typeof round.captainAudioUrl === 'string' ? round.captainAudioUrl : undefined,
    crewAudioUrl: typeof round.crewAudioUrl === 'string' ? round.crewAudioUrl : undefined,
    captainAudioPath: typeof round.captainAudioPath === 'string' ? round.captainAudioPath : undefined,
    crewAudioPath: typeof round.crewAudioPath === 'string' ? round.crewAudioPath : undefined,
    captainAudioMimeType: typeof round.captainAudioMimeType === 'string' ? round.captainAudioMimeType : undefined,
    crewAudioMimeType: typeof round.crewAudioMimeType === 'string' ? round.crewAudioMimeType : undefined,
  };
}

function saveLocalHistory(rounds: RoundRecord[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(rounds.slice(0, 50)));
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)).filter((item) => item !== undefined) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, stripUndefinedDeep(entry)])
        .filter(([, entry]) => entry !== undefined),
    ) as T;
  }
  return value;
}

export async function saveSettings(settings: GameSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  if (db) {
    await setDoc(doc(db, 'game_settings', 'default'), settings);
  }
}

export async function loadSettings(): Promise<GameSettings> {
  if (db) {
    const snap = await getDoc(doc(db, 'game_settings', 'default'));
    if (snap.exists()) {
      const remote = snap.data() as Partial<GameSettings>;
      const merged = { ...defaultGameSettings, ...remote };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
      return merged;
    }
  }

  const local = localStorage.getItem(SETTINGS_KEY);
  if (local) {
    return { ...defaultGameSettings, ...JSON.parse(local) };
  }
  return defaultGameSettings;
}

export async function saveRound(round: RoundRecord) {
  const normalized = normalizeRound(round);
  const local = loadLocalHistory().filter((entry) => entry.id !== normalized.id);
  local.unshift(normalized);
  saveLocalHistory(local);

  if (db) {
    await setDoc(doc(db, 'rounds', normalized.id), stripUndefinedDeep(normalized), { merge: true });
  }
}

export function loadCachedRounds(): RoundRecord[] {
  return loadLocalHistory();
}

export async function loadRecentRounds(maxRounds = 20): Promise<RoundRecord[]> {
  const cached = loadLocalHistory();
  const cappedLimit = Math.max(1, Math.min(200, Math.round(maxRounds)));
  if (db) {
    try {
      const q = query(collection(db, 'rounds'), orderBy('createdAt', 'desc'), limit(cappedLimit));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const rounds = snap.docs.map((d) => normalizeRound(d.data() as RoundRecord));
        saveLocalHistory(rounds);
        return rounds;
      }
    } catch {
      // Keep History usable when Firestore is slow or temporarily unavailable.
    }
  }
  return cached;
}

function loadLocalHistory(): RoundRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map((item) => normalizeRound(item as Partial<RoundRecord>)) : [];
  } catch {
    return [];
  }
}
