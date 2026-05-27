export interface SupabaseLearnerStat {
  userId: string;
  displayName: string;
  totalSessions: number;
  avgScore: number;
  bestScore: number;
  totalPracticeSeconds: number;
  lastSessionAt: string | null;
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function normalizeStat(row: any, displayNames: Map<string, string>): SupabaseLearnerStat {
  const userId = String(row?.user_id || '');
  return {
    userId,
    displayName: displayNames.get(userId) || `Learner ${userId.slice(0, 8) || 'unknown'}`,
    totalSessions: Number(row?.total_sessions || 0),
    avgScore: Number(row?.avg_score || 0),
    bestScore: Number(row?.best_score || 0),
    totalPracticeSeconds: Number(row?.total_practice_seconds || 0),
    lastSessionAt: row?.last_session_at ? String(row.last_session_at) : null,
  };
}

function unwrapStatsPayload(payload: any): any[] {
  if (Array.isArray(payload)) {
    if (payload.length === 1 && Array.isArray(payload[0]?.stats)) return payload[0].stats;
    return payload;
  }
  if (Array.isArray(payload?.stats)) return payload.stats;
  return [];
}

async function supabaseFetch(path: string, init?: RequestInit) {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase is not configured for this frontend build.');
  }

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase request failed (${response.status}).`);
  }
  return response.json();
}

export async function loadSupabaseLearnerStats(): Promise<SupabaseLearnerStat[]> {
  if (!supabaseUrl || !supabaseKey) return [];

  const [statsPayload, profilesPayload] = await Promise.all([
    supabaseFetch('/rest/v1/rpc/get_all_learner_stats', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
    supabaseFetch('/rest/v1/profiles?select=user_id,display_name'),
  ]);

  const displayNames = new Map<string, string>();
  if (Array.isArray(profilesPayload)) {
    for (const profile of profilesPayload) {
      const userId = String(profile?.user_id || '');
      const displayName = String(profile?.display_name || '').trim();
      if (userId && displayName) displayNames.set(userId, displayName);
    }
  }

  return unwrapStatsPayload(statsPayload)
    .map((row) => normalizeStat(row, displayNames))
    .filter((row) => row.userId && row.totalSessions > 0)
    .sort((a, b) => new Date(b.lastSessionAt || 0).getTime() - new Date(a.lastSessionAt || 0).getTime());
}
