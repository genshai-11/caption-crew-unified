import { useEffect, useMemo, useState } from 'react';
import { loadRecentRounds } from '@/services/roundRepository';
import { loadSupabaseLearnerStats, type SupabaseLearnerStat } from '@/services/supabaseHistoryRepository';
import type { RoundRecord } from '@/types';

type RoleFilter = 'all' | 'captain' | 'crew';
type LearnerOption = {
  key: string;
  label: string;
  roleHint: string;
};

type RoleRound = {
  round: RoundRecord;
  role: 'captain' | 'crew';
};

type NumberSummary = {
  min: number | null;
  avg: number | null;
  max: number | null;
};

const SUCCESS_THRESHOLD = 50;

function safeNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function average(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function summarize(values: Array<number | null | undefined>): NumberSummary {
  const finite = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (finite.length === 0) return { min: null, avg: null, max: null };
  return {
    min: Math.min(...finite),
    avg: finite.reduce((sum, value) => sum + value, 0) / finite.length,
    max: Math.max(...finite),
  };
}

function formatMetric(value: number | null | undefined, digits = 1, suffix = '') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}${suffix}`;
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${Math.round(value)}%`;
}

function cvrOf(round: RoundRecord) {
  return safeNumber(round.metrics?.cvr.rawUnits ?? round.ohmResult?.totalOhm);
}

function cciOf(round: RoundRecord) {
  return safeNumber(round.metrics?.cci.score ?? round.metrics?.cci.current ?? (safeNumber(round.evaluation?.matchScore) ?? 0) / 100);
}

function cpdOf(round: RoundRecord) {
  return safeNumber(round.metrics?.cpd.raw ?? round.metrics?.cpd.score);
}

function meaningOf(round: RoundRecord) {
  return safeNumber(round.metrics?.cci.llmMeaningPercent ?? round.evaluation?.matchScore);
}

function isAnswerable(round: RoundRecord) {
  return (meaningOf(round) ?? 0) > SUCCESS_THRESHOLD;
}

function participantKey(round: RoundRecord, role: 'captain' | 'crew') {
  const id = role === 'captain' ? round.captainPlayerId : round.crewPlayerId;
  const name = role === 'captain' ? round.captainName : round.crewName;
  if (id) return `${role}:id:${id}`;
  if (name) return `${role}:name:${name.trim().toLowerCase()}`;
  return `${role}:unknown`;
}

function participantLabel(round: RoundRecord, role: 'captain' | 'crew') {
  const name = role === 'captain' ? round.captainName : round.crewName;
  if (name?.trim()) return name.trim();
  return role === 'captain' ? 'Unknown Captain' : 'Unknown Crew';
}

function matchesLearner(round: RoundRecord, learnerKey: string, role: 'captain' | 'crew') {
  return learnerKey === 'all' || participantKey(round, role) === learnerKey;
}

function buildRoleRounds(rounds: RoundRecord[], learnerKey: string, roleFilter: RoleFilter): RoleRound[] {
  const output: RoleRound[] = [];
  for (const round of rounds) {
    if ((roleFilter === 'all' || roleFilter === 'captain') && matchesLearner(round, learnerKey, 'captain')) {
      output.push({ round, role: 'captain' });
    }
    if ((roleFilter === 'all' || roleFilter === 'crew') && matchesLearner(round, learnerKey, 'crew')) {
      output.push({ round, role: 'crew' });
    }
  }
  return output;
}

function buildLearners(rounds: RoundRecord[]): LearnerOption[] {
  const learners = new Map<string, LearnerOption>();
  for (const round of rounds) {
    (['captain', 'crew'] as const).forEach((role) => {
      const key = participantKey(round, role);
      if (!learners.has(key)) {
        learners.set(key, {
          key,
          label: participantLabel(round, role),
          roleHint: role === 'captain' ? 'Captain history' : 'Crew history',
        });
      }
    });
  }
  return [{ key: 'all', label: 'All learners', roleHint: 'Combined history' }, ...Array.from(learners.values())];
}

function getStabilityIndex(roleRounds: RoleRound[]) {
  const cciValues = roleRounds.map(({ round }) => cciOf(round)).filter((value): value is number => value != null);
  const delayValues = roleRounds.map(({ round }) => safeNumber(round.reactionDelayMs)).filter((value): value is number => value != null);
  if (cciValues.length === 0) return null;

  const cciAvg = average(cciValues) ?? 0;
  const cciVariance = average(cciValues.map((value) => Math.abs(value - cciAvg))) ?? 0;
  const delayAvg = average(delayValues) ?? 0;
  const delayVarianceRatio = delayAvg > 0 ? (average(delayValues.map((value) => Math.abs(value - delayAvg))) ?? 0) / delayAvg : 0;
  const cciConsistency = Math.max(0, 100 - cciVariance * 100);
  const delayConsistency = Math.max(0, 100 - delayVarianceRatio * 70);
  return delayValues.length > 0 ? (cciConsistency * 0.65 + delayConsistency * 0.35) : cciConsistency;
}

function KpiCard({ label, value, note, tone }: { label: string; value: string; note: string; tone?: 'red' | 'green' | 'blue' }) {
  return (
    <article className={`soft-card profile-kpi-card ${tone ? `profile-kpi-${tone}` : ''}`}>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}

function EmptyPanel({ title }: { title: string }) {
  return (
    <section className="soft-card admin-section-minimal">
      <p className="page-kicker">{title}</p>
      <p className="muted-copy">No matching history yet. Play more rounds or adjust learner / role filters.</p>
    </section>
  );
}

function CaptainCvrDistribution({ rounds }: { rounds: RoleRound[] }) {
  const bands = [
    { label: '0–40Ω', min: 0, max: 40 },
    { label: '41–80Ω', min: 41, max: 80 },
    { label: '81–120Ω', min: 81, max: 120 },
    { label: '120Ω+', min: 121, max: Infinity },
  ].map((band) => {
    const bandRounds = rounds.filter(({ round }) => {
      const cvr = cvrOf(round);
      return cvr != null && cvr >= band.min && cvr <= band.max;
    });
    const successCount = bandRounds.filter(({ round }) => isAnswerable(round)).length;
    return {
      ...band,
      count: bandRounds.length,
      successRate: bandRounds.length > 0 ? (successCount / bandRounds.length) * 100 : 0,
    };
  });
  const maxCount = Math.max(1, ...bands.map((band) => band.count));

  return (
    <div className="profile-chart-wrap" aria-label="CVR band distribution">
      <svg viewBox="0 0 420 190" role="img" className="profile-chart-svg">
        <line x1="32" y1="142" x2="398" y2="142" className="profile-axis" />
        {bands.map((band, index) => {
          const x = 56 + index * 88;
          const height = (band.count / maxCount) * 96;
          const y = 142 - height;
          const successHeight = height * (band.successRate / 100);
          return (
            <g key={band.label}>
              <rect x={x} y={y} width="46" height={height} rx="12" className="profile-bar-red" />
              <rect x={x} y={142 - successHeight} width="46" height={successHeight} rx="12" className="profile-bar-green" />
              <text x={x + 23} y="166" textAnchor="middle" className="profile-chart-label">{band.label}</text>
              <text x={x + 23} y={Math.max(20, y - 8)} textAnchor="middle" className="profile-chart-value">{band.count}</text>
            </g>
          );
        })}
      </svg>
      <p className="admin-message">Red bars show Captain resistance volume; green overlay shows Crew answerable rate above 50% meaning.</p>
    </div>
  );
}

function CrewTrendChart({ rounds }: { rounds: RoleRound[] }) {
  const ordered = [...rounds]
    .sort((a, b) => new Date(a.round.createdAt).getTime() - new Date(b.round.createdAt).getTime())
    .slice(-8);
  const cciValues = ordered.map(({ round }) => cciOf(round) ?? 0);
  const cpdValues = ordered.map(({ round }) => cpdOf(round) ?? 0);
  const maxCci = Math.max(1, ...cciValues);
  const maxCpd = Math.max(1, ...cpdValues);
  const point = (value: number, index: number, maxValue: number) => {
    const x = 36 + index * (ordered.length > 1 ? 330 / (ordered.length - 1) : 0);
    const y = 142 - (value / maxValue) * 96;
    return `${x},${y}`;
  };

  if (ordered.length === 0) {
    return <p className="muted-copy">No trend data yet.</p>;
  }

  return (
    <div className="profile-chart-wrap" aria-label="Crew CCI and CPD trend">
      <svg viewBox="0 0 420 190" role="img" className="profile-chart-svg">
        <line x1="32" y1="142" x2="398" y2="142" className="profile-axis" />
        <polyline points={cciValues.map((value, index) => point(value, index, maxCci)).join(' ')} className="profile-line-green" />
        <polyline points={cpdValues.map((value, index) => point(value, index, maxCpd)).join(' ')} className="profile-line-blue" />
        {ordered.map(({ round }, index) => {
          const x = 36 + index * (ordered.length > 1 ? 330 / (ordered.length - 1) : 0);
          return <text key={round.id} x={x} y="166" textAnchor="middle" className="profile-chart-label">R{index + 1}</text>;
        })}
      </svg>
      <p className="admin-message"><span className="metric-cci">Green</span> = CCI current stability. <span className="metric-cpd">Blue</span> = CPD output under resistance.</p>
    </div>
  );
}

function CaptainPanel({ rounds }: { rounds: RoleRound[] }) {
  if (rounds.length === 0) return <EmptyPanel title="Captain analysis" />;

  const cvrSummary = summarize(rounds.map(({ round }) => cvrOf(round)));
  const delaySummary = summarize(rounds.map(({ round }) => safeNumber(round.reactionDelayMs)));
  const answerableRate = (rounds.filter(({ round }) => isAnswerable(round)).length / rounds.length) * 100;
  const challengePressure = cvrSummary.avg != null ? Math.max(0, cvrSummary.avg * (1 - answerableRate / 100)) : null;
  const hardestSolved = Math.max(0, ...rounds.filter(({ round }) => isAnswerable(round)).map(({ round }) => cvrOf(round) ?? 0));

  return (
    <section className="profile-section-stack">
      <div className="section-title-row">
        <div>
          <p className="page-kicker">Captain analysis</p>
          <h2 className="section-title">Reaction / improvisation pressure via <span className="metric-cvr">CVR</span></h2>
        </div>
      </div>
      <div className="profile-kpi-grid">
        <KpiCard label="CVR range" value={`${formatMetric(cvrSummary.min, 0, 'Ω')} → ${formatMetric(cvrSummary.max, 0, 'Ω')}`} note={`Average ${formatMetric(cvrSummary.avg, 1, 'Ω')} across ${rounds.length} captain round(s).`} tone="red" />
        <KpiCard label="Crew answerable rate" value={formatPercent(answerableRate)} note={`Meaning score above ${SUCCESS_THRESHOLD}% is counted as answerable.`} tone="green" />
        <KpiCard label="Challenge pressure" value={formatMetric(challengePressure, 1, 'Ω')} note="Higher when CVR stays high while Crew answerability drops." tone="blue" />
        <KpiCard label="Reaction window" value={formatMetric(delaySummary.avg != null ? delaySummary.avg / 1000 : null, 2, 's')} note={`Fastest ${formatMetric(delaySummary.min != null ? delaySummary.min / 1000 : null, 2, 's')} · slowest ${formatMetric(delaySummary.max != null ? delaySummary.max / 1000 : null, 2, 's')}.`} />
      </div>
      <section className="soft-card admin-section-minimal">
        <div className="section-title-row">
          <h3 className="section-title">CVR bands vs answerability</h3>
          <span className="status-dot status-ready">hardest solved {hardestSolved.toFixed(0)}Ω</span>
        </div>
        <CaptainCvrDistribution rounds={rounds} />
      </section>
    </section>
  );
}

function CrewPanel({ rounds }: { rounds: RoleRound[] }) {
  if (rounds.length === 0) return <EmptyPanel title="Crew analysis" />;

  const cciAvg = average(rounds.map(({ round }) => cciOf(round)));
  const cpdAvg = average(rounds.map(({ round }) => cpdOf(round)));
  const answerableRate = (rounds.filter(({ round }) => isAnswerable(round)).length / rounds.length) * 100;
  const stabilityIndex = getStabilityIndex(rounds);
  const highestHandled = Math.max(0, ...rounds.filter(({ round }) => isAnswerable(round)).map(({ round }) => cvrOf(round) ?? 0));

  return (
    <section className="profile-section-stack">
      <div className="section-title-row">
        <div>
          <p className="page-kicker">Crew analysis</p>
          <h2 className="section-title">Static level via <span className="metric-cci">CCI</span> + <span className="metric-cpd">CPD</span></h2>
        </div>
      </div>
      <div className="profile-kpi-grid">
        <KpiCard label="Average CCI" value={formatMetric(cciAvg, 2, 'A')} note="Meaning current after MSE coefficient. Stable Crew stays high." tone="green" />
        <KpiCard label="Average CPD" value={formatMetric(cpdAvg, 1, 'V')} note="Blue outcome: Crew current multiplied by Captain resistance." tone="blue" />
        <KpiCard label="Static stability" value={formatPercent(stabilityIndex)} note="Consistency score from CCI variation and reaction-delay variation." />
        <KpiCard label="Highest CVR handled" value={`${highestHandled.toFixed(0)}Ω`} note={`${formatPercent(answerableRate)} of Crew rounds crossed the ${SUCCESS_THRESHOLD}% meaning threshold.`} tone="red" />
      </div>
      <section className="soft-card admin-section-minimal">
        <div className="section-title-row">
          <h3 className="section-title">CCI / CPD trend</h3>
          <span className="status-dot status-ready">last {Math.min(8, rounds.length)} rounds</span>
        </div>
        <CrewTrendChart rounds={rounds} />
      </section>
    </section>
  );
}

function SupabaseStatsPanel({ stats, loading }: { stats: SupabaseLearnerStat[]; loading: boolean }) {
  const totals = useMemo(() => {
    const sessions = stats.reduce((sum, row) => sum + row.totalSessions, 0);
    const practiceSeconds = stats.reduce((sum, row) => sum + row.totalPracticeSeconds, 0);
    const avgScore = stats.length > 0 ? stats.reduce((sum, row) => sum + row.avgScore, 0) / stats.length : null;
    const best = stats.reduce<SupabaseLearnerStat | null>((current, row) => !current || row.bestScore > current.bestScore ? row : current, null);
    return { sessions, practiceSeconds, avgScore, best };
  }, [stats]);

  return (
    <section className="profile-section-stack">
      <div className="section-title-row">
        <div>
          <p className="page-kicker">Supabase history source</p>
          <h2 className="section-title">Stored in <span className="metric-cci">practice_results</span></h2>
        </div>
        <span className="status-dot status-ready">{loading ? 'loading' : `${stats.length} active learner(s)`}</span>
      </div>

      <div className="profile-kpi-grid">
        <KpiCard label="Active learners" value={String(stats.length)} note="Profiles with at least one Supabase practice result." tone="green" />
        <KpiCard label="Practice rows" value={String(totals.sessions)} note="Rows from Supabase practice_results via learner stats RPC." tone="blue" />
        <KpiCard label="Average score" value={formatPercent(totals.avgScore)} note="Average of learner average scores; useful for Crew static level." />
        <KpiCard label="Best learner" value={totals.best ? formatPercent(totals.best.bestScore) : '—'} note={totals.best ? totals.best.displayName : 'No Supabase learner stats loaded.'} tone="red" />
      </div>

      <section className="soft-card admin-section-minimal">
        <div className="section-title-row">
          <h3 className="section-title">Recent Supabase learners</h3>
          <span className="soft-label">practice_results + profiles</span>
        </div>
        {stats.length === 0 ? (
          <p className="muted-copy">No Supabase stats loaded yet. Check Supabase env config or RLS/RPC access.</p>
        ) : (
          <div className="profile-table-wrap">
            <table className="profile-table">
              <thead>
                <tr>
                  <th>Learner</th>
                  <th>Sessions</th>
                  <th>Avg</th>
                  <th>Best</th>
                  <th>Practice</th>
                  <th>Last</th>
                </tr>
              </thead>
              <tbody>
                {stats.slice(0, 10).map((row) => (
                  <tr key={row.userId}>
                    <td>{row.displayName}</td>
                    <td>{row.totalSessions}</td>
                    <td>{formatPercent(row.avgScore)}</td>
                    <td>{formatPercent(row.bestScore)}</td>
                    <td>{formatMetric(row.totalPracticeSeconds / 60, 1, 'm')}</td>
                    <td>{row.lastSessionAt ? new Date(row.lastSessionAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="admin-message">Note: Supabase CVR prompt history is in cvr_history, but most rows are not linked to learner IDs. Role-level Captain/Crew analysis still uses Firebase round records until the two histories are bridged.</p>
      </section>
    </section>
  );
}

function RoundInsightTable({ roleRounds }: { roleRounds: RoleRound[] }) {
  const rows = [...roleRounds]
    .sort((a, b) => new Date(b.round.createdAt).getTime() - new Date(a.round.createdAt).getTime())
    .slice(0, 8);

  return (
    <section className="soft-card admin-section-minimal">
      <div className="section-title-row">
        <h2 className="section-title">Recent evidence</h2>
        <span className="soft-label">history database</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted-copy">No matching rows.</p>
      ) : (
        <div className="profile-table-wrap">
          <table className="profile-table">
            <thead>
              <tr>
                <th>Round</th>
                <th>Role</th>
                <th>CVR</th>
                <th>CCI</th>
                <th>CPD</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ round, role }) => (
                <tr key={`${round.id}-${role}`}>
                  <td>{new Date(round.createdAt).toLocaleDateString()}</td>
                  <td><span className={`analysis-pill ${role === 'captain' ? 'decision-mismatch' : 'decision-match'}`}>{role}</span></td>
                  <td>{formatMetric(cvrOf(round), 0, 'Ω')}</td>
                  <td>{formatMetric(cciOf(round), 2, 'A')}</td>
                  <td>{formatMetric(cpdOf(round), 1, 'V')}</td>
                  <td>{formatPercent(meaningOf(round))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function ProfileAnalysisPage() {
  const [rounds, setRounds] = useState<RoundRecord[]>([]);
  const [supabaseStats, setSupabaseStats] = useState<SupabaseLearnerStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [supabaseLoading, setSupabaseLoading] = useState(true);
  const [learnerKey, setLearnerKey] = useState('all');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadRecentRounds(100)
      .then((loadedRounds) => {
        if (!cancelled) setRounds(loadedRounds);
      })
      .catch(() => {
        if (!cancelled) setRounds([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    loadSupabaseLearnerStats()
      .then((loadedStats) => {
        if (!cancelled) setSupabaseStats(loadedStats);
      })
      .catch(() => {
        if (!cancelled) setSupabaseStats([]);
      })
      .finally(() => {
        if (!cancelled) setSupabaseLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const learners = useMemo(() => buildLearners(rounds), [rounds]);
  const roleRounds = useMemo(() => buildRoleRounds(rounds, learnerKey, roleFilter), [rounds, learnerKey, roleFilter]);
  const captainRounds = useMemo(() => buildRoleRounds(rounds, learnerKey, 'captain'), [rounds, learnerKey]);
  const crewRounds = useMemo(() => buildRoleRounds(rounds, learnerKey, 'crew'), [rounds, learnerKey]);
  const selectedLearner = learners.find((learner) => learner.key === learnerKey) || learners[0];

  return (
    <main className="screen-shell admin-shell profile-analysis-shell">
      <header className="page-header profile-analysis-header">
        <div>
          <p className="page-kicker">Profile analysis</p>
          <h1 className="page-title">Learner history dashboard</h1>
          <p className="muted-copy">Captain reads resistance and improvisation through CVR. Crew reads static strength through CCI + CPD.</p>
        </div>
      </header>

      <section className="soft-card admin-section-minimal profile-filter-card">
        <div className="admin-grid two-up">
          <label className="field-stack">
            <span>Choose learner</span>
            <select value={learnerKey} onChange={(event) => setLearnerKey(event.target.value)}>
              {learners.map((learner) => (
                <option key={learner.key} value={learner.key}>{learner.label} · {learner.roleHint}</option>
              ))}
            </select>
          </label>
          <label className="field-stack">
            <span>Filter role</span>
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}>
              <option value="all">All roles</option>
              <option value="captain">Captain only</option>
              <option value="crew">Crew only</option>
            </select>
          </label>
        </div>
        <p className="admin-message">
          Showing {roleRounds.length} role-view(s) from {rounds.length} saved round(s) for <strong>{selectedLearner?.label || 'All learners'}</strong>.
          {loading ? ' Loading history…' : ''}
        </p>
      </section>

      <SupabaseStatsPanel stats={supabaseStats} loading={supabaseLoading} />
      {(roleFilter === 'all' || roleFilter === 'captain') && <CaptainPanel rounds={captainRounds} />}
      {(roleFilter === 'all' || roleFilter === 'crew') && <CrewPanel rounds={crewRounds} />}
      <RoundInsightTable roleRounds={roleRounds} />
    </main>
  );
}
