import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
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
    captainTranscript: round.captainTranscript,
    crewTranscript: round.crewTranscript,
    captainVerifiedTranscript: round.captainVerifiedTranscript,
    crewVerifiedTranscript: round.crewVerifiedTranscript,
    ohmResult: round.ohmResult,
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

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as Partial<T>;
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

  const uid = auth?.currentUser?.uid || null;
  if (db && uid) {
    const safePayload = stripUndefined(normalized as unknown as Record<string, unknown>);
    await setDoc(doc(db, 'users', uid, 'history', normalized.id), safePayload, { merge: true });
  }
}

export async function loadRecentRounds(): Promise<RoundRecord[]> {
  const uid = auth?.currentUser?.uid || null;
  if (db && uid) {
    const q = query(collection(db, 'users', uid, 'history'), orderBy('createdAt', 'desc'), limit(20));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const rounds = snap.docs.map((d) => normalizeRound(d.data() as RoundRecord));
      saveLocalHistory(rounds);
      return rounds;
    }
  }
  return loadLocalHistory();
}

function loadLocalHistory(): RoundRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map((item) => normalizeRound(item as Partial<RoundRecord>)) : [];
  } catch {
    return [];
  }
}
