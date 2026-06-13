import { useEffect, useMemo, useState } from 'react';
import { loadCachedRounds, loadRecentRounds } from '@/services/roundRepository';
import FlexibleChart, { type ChartPreset, type RoleRound } from '@/components/FlexibleChart';
import type { RoundRecord } from '@/types';

type RoleFilter = 'all' | 'captain' | 'crew';
type LearnerOption = { key: string; label: string; roleHint: string };
type NumberSummary = { min: number | null; avg: number | null; max: number | null };

const CREW_PASS_THRESHOLD = 50;

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

function participantKey(round: RoundRecord, role: 'captain' | 'crew') {
  const id = role === 'captain' ? round.captainPlayerId : round.crewPlayerId;
  const name = role === 'captain' ? round.captainName : round.crewName;
  if (id) return `${role}:id:${id}`;
  if (name) return `${role}:name:${name.trim().toLowerCase()}`;
  return `${role}:unknown`;
}

function participantLabel(round: RoundRecord, role: 'captain' | 'crew') {
  const name = role === 'captain' ? round.captainName : round.crewName;
  return name?.trim() || (role === 'captain' ? 'Unknown Captain' : 'Unknown Crew');
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

function buildLearners(rounds: RoundRecord[], roleFilter: RoleFilter): LearnerOption[] {
  const learners = new Map<string, LearnerOption>();
  const roles = roleFilter === 'captain' ? ['captain'] as const : roleFilter === 'crew' ? ['crew'] as const : ['captain', 'crew'] as const;
  for (const round of rounds) {
    roles.forEach((role) => {
      const key = participantKey(round, role);
      if (!learners.has(key)) {
        learners.set(key, {
          key,
          label: participantLabel(round, role),
          roleHint: role === 'captain' ? 'Captain round history' : 'Crew round history',
        });
      }
    });
  }
  const allLabel = roleFilter === 'captain' ? 'All captains' : roleFilter === 'crew' ? 'All crews' : 'All learners';
  return [{ key: 'all', label: allLabel, roleHint: 'Same source as History / Firebase rounds' }, ...Array.from(learners.values())];
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

function getCpdCoverageCeiling(roleRounds: RoleRound[], threshold: number) {
  const passing = roleRounds
    .filter(({ round }) => (meaningOf(round) ?? 0) > threshold)
    .map(({ round }) => cvrOf(round))
    .filter((value): value is number => value != null);
  return passing.length > 0 ? Math.max(...passing) : 0;
}

const CAPTAIN_PRESETS: ChartPreset[] = [
  {
    id: 'captain-distribution',
    label: 'CVR Distribution',
    chartType: 'bar',
    xAxis: 'cvrBand',
    role: 'captain',
    description: 'How often Captain sets each difficulty level. Green overlay = Crew passed.',
    series: [
      { id: 'cvr', metric: 'cvr', label: 'CVR', renderAs: 'bar', color: 'var(--red, #ef4444)' },
    ],
    readingGuide: {
      title: 'How to read this chart',
      summary: 'Each bar groups rounds by Captain difficulty band.',
      notes: [
        { id: 'dist-cvr', title: 'Bar height', body: 'Higher bars mean Captain used that difficulty band more often.', seriesId: 'cvr' },
        { id: 'dist-pass', title: 'Green overlay', body: 'Green shows the share of rounds where Crew still passed the meaning threshold.' },
      ],
    },
  },
  {
    id: 'captain-progression',
    label: 'CVR Progression',
    chartType: 'line',
    xAxis: 'round',
    role: 'captain',
    description: 'Captain CVR trend over time — rising means growing improvisation skill.',
    series: [
      { id: 'cvr', metric: 'cvr', label: 'CVR', renderAs: 'line', style: 'solid', color: 'var(--red, #ef4444)', width: 4 },
    ],
    readingGuide: {
      title: 'How to read this chart',
      notes: [
        { id: 'prog-cvr', title: 'CVR line', body: 'When the red line rises over later rounds, Captain is setting harder prompts.' },
      ],
    },
  },
  {
    id: 'captain-profile',
    label: 'CVR Component Profile',
    chartType: 'heatmap',
    xAxis: 'round',
    role: 'captain',
    description: 'Normalized heatmap: which CVR component (TC, TL, LC) does Captain push hardest?',
    series: [
      { id: 'tc', metric: 'tc', label: 'TC', color: '#f59e0b' },
      { id: 'tl', metric: 'tl', label: 'TL', color: '#8b5cf6' },
      { id: 'lc', metric: 'lc', label: 'LC', color: '#ec4899' },
    ],
    readingGuide: {
      title: 'How to read this chart',
      summary: 'Darker cells mean that component is stronger in that round relative to the player’s own history.',
      notes: [
        { id: 'heat-tc', title: 'TC', body: 'TC rises when more chunk resources / semantic payload are packed into the sentence.', seriesId: 'tc' },
        { id: 'heat-tl', title: 'TL', body: 'TL rises when the topic becomes more abstract or domain-specific.', seriesId: 'tl' },
        { id: 'heat-lc', title: 'LC', body: 'LC rises when sentence length or structural density increases.', seriesId: 'lc' },
      ],
    },
  },
  {
    id: 'captain-challenge',
    label: 'Challenge Rate',
    chartType: 'bar',
    xAxis: 'cvrBand',
    role: 'captain',
    description: 'Captain success at blocking Crew per CVR band. Red = attempts, green = Crew passed.',
    series: [
      { id: 'meaning', metric: 'meaning', label: 'Semantics %', renderAs: 'bar', color: '#10b981' },
    ],
    readingGuide: {
      title: 'How to read this chart',
      notes: [
        { id: 'challenge-bar', title: 'Average semantics', body: 'Higher values mean Crew still preserved more meaning inside that Captain difficulty band.', seriesId: 'meaning' },
      ],
    },
  },
];

const CREW_PRESETS: ChartPreset[] = [
  {
    id: 'crew-static',
    label: 'Static Level (CCI vs CVR)',
    chartType: 'scatter',
    xAxis: 'cvr',
    role: 'crew',
    description: 'Crew composure under pressure. Flat = high static stability. Switch Y to CPD for outcome view.',
    series: [
      { id: 'cci', metric: 'cci', label: 'CCI', renderAs: 'dot', color: '#10b981' },
    ],
    readingGuide: {
      title: 'How to read this chart',
      notes: [
        { id: 'static-x', title: 'X = CVR', body: 'Further right means the Crew was answering harder prompts.' },
        { id: 'static-y', title: 'Y = CCI', body: 'Higher dots mean stronger semantic current under pressure.', seriesId: 'cci' },
      ],
    },
  },
  {
    id: 'crew-trend',
    label: 'Semantics + CCI + CPD Trend',
    chartType: 'line',
    xAxis: 'round',
    role: 'crew',
    description: 'Crew output over time. Compare semantics preservation, current stability, and final outcome in one view.',
    series: [
      { id: 'meaning', metric: 'meaning', label: 'Semantics %', renderAs: 'line', style: 'solid', color: '#22c55e', width: 3 },
      { id: 'cci', metric: 'cci', label: 'CCI', renderAs: 'line', style: 'dashed', color: '#10b981', width: 3 },
      { id: 'cpd', metric: 'cpd', label: 'CPD', renderAs: 'line', style: 'solid', color: 'var(--blue, #3b82f6)', width: 4, axis: 'right' },
    ],
    readingGuide: {
      title: 'How to read this chart',
      summary: 'Read left to right by round. First compare direction, then compare the distance between the three lines.',
      notes: [
        { id: 'crew-meaning', title: 'Semantics %', body: 'Higher green means the Crew preserved more of the Captain’s meaning.', seriesId: 'meaning' },
        { id: 'crew-cci', title: 'CCI', body: 'CCI shows semantic current. A flatter line means steadier response quality.', seriesId: 'cci' },
        { id: 'crew-cpd', title: 'CPD', body: 'CPD is the final output under pressure: CCI × CVR. Rising blue means stronger delivery under harder prompts.', seriesId: 'cpd' },
      ],
    },
  },
];

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
      <p className="muted-copy">No matching round history yet. This dashboard uses the same source as /history: Firebase Firestore rounds + local cache fallback.</p>
    </section>
  );
}

function CaptainPanel({ rounds }: { rounds: RoleRound[] }) {
  if (rounds.length === 0) return <EmptyPanel title="Captain analysis" />;

  const cvrSummary = summarize(rounds.map(({ round }) => cvrOf(round)));
  const delaySummary = summarize(rounds.map(({ round }) => safeNumber(round.reactionDelayMs)));
  const answerableRate = (rounds.filter(({ round }) => (meaningOf(round) ?? 0) > CREW_PASS_THRESHOLD).length / rounds.length) * 100;
  const challengePressure = cvrSummary.avg != null ? Math.max(0, cvrSummary.avg * (1 - answerableRate / 100)) : null;
  const hardestSolved = Math.max(0, ...rounds.filter(({ round }) => (meaningOf(round) ?? 0) > CREW_PASS_THRESHOLD).map(({ round }) => cvrOf(round) ?? 0));

  return (
    <section className="profile-section-stack">
      <div className="section-title-row">
        <div>
          <p className="page-kicker">Captain analysis</p>
          <h2 className="section-title">Improvisation & adaptation via <span className="metric-cvr">CVR</span></h2>
        </div>
      </div>
      <div className="profile-kpi-grid">
        <KpiCard label="CVR range" value={`${formatMetric(cvrSummary.min, 0, 'Ω')} → ${formatMetric(cvrSummary.max, 0, 'Ω')}`} note={`Average ${formatMetric(cvrSummary.avg, 1, 'Ω')} across ${rounds.length} captain round(s).`} tone="red" />
        <KpiCard label="Crew pass rate" value={formatPercent(answerableRate)} note={`Crew meaning above ${CREW_PASS_THRESHOLD}% = pass.`} tone="green" />
        <KpiCard label="Challenge pressure" value={formatMetric(challengePressure, 1, 'Ω')} note="Higher when CVR stays high while Crew pass rate drops." tone="blue" />
        <KpiCard label="Reaction window" value={formatMetric(delaySummary.avg != null ? delaySummary.avg / 1000 : null, 2, 's')} note={`Fastest ${formatMetric(delaySummary.min != null ? delaySummary.min / 1000 : null, 2, 's')} · slowest ${formatMetric(delaySummary.max != null ? delaySummary.max / 1000 : null, 2, 's')}.`} />
      </div>
      <section className="soft-card admin-section-minimal">
        <div className="section-title-row">
          <h3 className="section-title">Captain chart</h3>
          <span className="status-dot status-ready">hardest solved {hardestSolved.toFixed(0)}Ω</span>
        </div>
        <FlexibleChart roleRounds={rounds} presets={CAPTAIN_PRESETS} defaultPresetId="captain-distribution" crewWinThreshold={CREW_PASS_THRESHOLD} />
      </section>
    </section>
  );
}

function CrewPanel({ rounds }: { rounds: RoleRound[] }) {
  if (rounds.length === 0) return <EmptyPanel title="Crew analysis" />;

  const cciAvg = average(rounds.map(({ round }) => cciOf(round)));
  const cpdAvg = average(rounds.map(({ round }) => cpdOf(round)));
  const answerableRate = (rounds.filter(({ round }) => (meaningOf(round) ?? 0) > CREW_PASS_THRESHOLD).length / rounds.length) * 100;
  const stabilityIndex = getStabilityIndex(rounds);
  const cpdCeiling = getCpdCoverageCeiling(rounds, CREW_PASS_THRESHOLD);

  return (
    <section className="profile-section-stack">
      <div className="section-title-row">
        <div>
          <p className="page-kicker">Crew analysis</p>
          <h2 className="section-title">Static composure via <span className="metric-cci">CCI</span> + <span className="metric-cpd">CPD</span></h2>
        </div>
      </div>
      <div className="profile-kpi-grid">
        <KpiCard label="Average CCI" value={formatMetric(cciAvg, 2, 'A')} note="Saved Crew current after CCI cards × (MSE + semantics decimal). Stable Crew stays high." tone="green" />
        <KpiCard label="Average CPD" value={formatMetric(cpdAvg, 1, 'V')} note="Blue outcome: final saved CCI × Captain resistance." tone="blue" />
        <KpiCard label="Static stability" value={formatPercent(stabilityIndex)} note="Consistency score from CCI variation and reaction-delay variation." />
        <KpiCard label="CPD coverage ceiling" value={`${cpdCeiling.toFixed(0)}Ω`} note={`Highest CVR where Crew still passed (>${CREW_PASS_THRESHOLD}%). ${formatPercent(answerableRate)} overall pass rate.`} tone="red" />
      </div>
      <section className="soft-card admin-section-minimal">
        <div className="section-title-row">
          <h3 className="section-title">Crew chart</h3>
          <span className="status-dot status-ready">last {Math.min(12, rounds.length)} rounds</span>
        </div>
        <FlexibleChart roleRounds={rounds} presets={CREW_PRESETS} defaultPresetId="crew-static" crewWinThreshold={CREW_PASS_THRESHOLD} />
      </section>
    </section>
  );
}

function RoundInsightTable({ roleRounds }: { roleRounds: RoleRound[] }) {
  const rows = [...roleRounds].sort((a, b) => new Date(b.round.createdAt).getTime() - new Date(a.round.createdAt).getTime()).slice(0, 8);
  return (
    <section className="soft-card admin-section-minimal">
      <div className="section-title-row">
        <h2 className="section-title">Recent evidence</h2>
        <span className="soft-label">Firebase rounds / same as History</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted-copy">No matching rows.</p>
      ) : (
        <div className="profile-table-wrap">
          <table className="profile-table">
            <thead><tr><th>Round</th><th>Role</th><th>CVR</th><th>CCI</th><th>CPD</th><th>Meaning</th></tr></thead>
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
  const [rounds, setRounds] = useState<RoundRecord[]>(() => loadCachedRounds());
  const [loading, setLoading] = useState(true);
  const [learnerKey, setLearnerKey] = useState('all');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadRecentRounds(100)
      .then((loadedRounds) => {
        if (!cancelled) setRounds(loadedRounds);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const learners = useMemo(() => buildLearners(rounds, roleFilter), [rounds, roleFilter]);
  const roleRounds = useMemo(() => buildRoleRounds(rounds, learnerKey, roleFilter), [rounds, learnerKey, roleFilter]);
  const captainRounds = useMemo(() => buildRoleRounds(rounds, learnerKey, 'captain'), [rounds, learnerKey]);
  const crewRounds = useMemo(() => buildRoleRounds(rounds, learnerKey, 'crew'), [rounds, learnerKey]);
  const selectedLearner = learners.find((learner) => learner.key === learnerKey) || learners[0];

  useEffect(() => {
    if (!learners.some((learner) => learner.key === learnerKey)) {
      setLearnerKey('all');
    }
  }, [learners, learnerKey]);

  return (
    <main className="screen-shell admin-shell profile-analysis-shell">
      <header className="page-header profile-analysis-header">
        <div>
          <p className="page-kicker">Profile analysis</p>
          <h1 className="page-title">Learner history dashboard</h1>
          <p className="muted-copy">Uses the same source as /history: Firebase Firestore rounds plus localStorage cache. Captain = CVR pressure. Crew = CCI + CPD static composure.</p>
        </div>
      </header>

      <section className="soft-card admin-section-minimal profile-filter-card">
        <div className="admin-grid two-up">
          <label className="field-stack">
            <span>Choose learner</span>
            <select value={learnerKey} onChange={(event) => setLearnerKey(event.target.value)}>
              {learners.map((learner) => <option key={learner.key} value={learner.key}>{learner.label} · {learner.roleHint}</option>)}
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
          Crew pass threshold: <strong>{CREW_PASS_THRESHOLD}%</strong>.
          {loading ? ' Refreshing from Firebase rounds…' : ''}
        </p>
      </section>

      {(roleFilter === 'all' || roleFilter === 'captain') && <CaptainPanel rounds={captainRounds} />}
      {(roleFilter === 'all' || roleFilter === 'crew') && <CrewPanel rounds={crewRounds} />}
      <RoundInsightTable roleRounds={roleRounds} />
    </main>
  );
}
