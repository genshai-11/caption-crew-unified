import { useEffect, useMemo, useState } from 'react';
import { loadCachedRounds, loadRecentRounds } from '@/services/roundRepository';
import { RoundRecord } from '@/types';

interface LearnerStats {
  key: string;
  name: string;
  captainRounds: number;
  crewRounds: number;
  cvrRawTotal: number;
  cvrScoreTotal: number;
  cciTotal: number;
  cpdScoreTotal: number;
  cpdCount: number;
  lastPlayedAt: string;
}

function formatScorePercent(score?: number | null) {
  const numeric = Number(score ?? 0);
  if (!Number.isFinite(numeric)) return '0%';
  return `${Math.max(0, Math.min(100, Math.round(numeric)))}%`;
}

function average(total: number, count: number) {
  if (!count) return null;
  return Math.round((total / count) * 10) / 10;
}

function formatAverage(value: number | null, suffix = '') {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value}${suffix}`;
}

function formatMetricValue(value?: number | null, digits = 1, suffix = '') {
  const numeric = Number(value ?? NaN);
  if (!Number.isFinite(numeric)) return '—';
  return `${numeric.toFixed(digits)}${suffix}`;
}

function learnerKey(id?: string | null, name?: string | null, fallback?: string) {
  const cleanId = String(id || '').trim();
  if (cleanId) return cleanId;
  const cleanName = String(name || '').trim();
  return cleanName ? `name:${cleanName.toLowerCase()}` : `unknown:${fallback || 'learner'}`;
}

function learnerName(name?: string | null, fallback = 'Unknown learner') {
  return String(name || '').trim() || fallback;
}

function buildLearnerStats(rounds: RoundRecord[]): LearnerStats[] {
  const map = new Map<string, LearnerStats>();

  const ensure = (key: string, name: string, playedAt: string) => {
    const existing = map.get(key);
    if (existing) {
      if (new Date(playedAt).getTime() > new Date(existing.lastPlayedAt).getTime()) {
        existing.lastPlayedAt = playedAt;
      }
      if (existing.name.startsWith('Unknown') && !name.startsWith('Unknown')) existing.name = name;
      return existing;
    }
    const next: LearnerStats = {
      key,
      name,
      captainRounds: 0,
      crewRounds: 0,
      cvrRawTotal: 0,
      cvrScoreTotal: 0,
      cciTotal: 0,
      cpdScoreTotal: 0,
      cpdCount: 0,
      lastPlayedAt: playedAt,
    };
    map.set(key, next);
    return next;
  };

  for (const round of rounds) {
    const captainKey = learnerKey(round.captainPlayerId, round.captainName, `${round.id}:captain`);
    const crewKey = learnerKey(round.crewPlayerId, round.crewName, `${round.id}:crew`);
    const captain = ensure(captainKey, learnerName(round.captainName, 'Unknown Captain'), round.createdAt);
    const crew = ensure(crewKey, learnerName(round.crewName, 'Unknown Crew'), round.createdAt);

    const cvrRaw = Number(round.metrics?.cvr.rawUnits || 0);
    const cvrScore = Number(round.metrics?.cvr.score || 0);
    const cciScore = Number(round.metrics?.cci.score ?? round.evaluation?.matchScore ?? 0);
    const cpdScore = Number(round.metrics?.cpd.raw ?? round.metrics?.cpd.score ?? 0);

    captain.captainRounds += 1;
    captain.cvrRawTotal += cvrRaw;
    captain.cvrScoreTotal += cvrScore;

    crew.crewRounds += 1;
    crew.cciTotal += cciScore;

    if (cpdScore > 0) {
      captain.cpdScoreTotal += cpdScore;
      captain.cpdCount += 1;
      crew.cpdScoreTotal += cpdScore;
      crew.cpdCount += 1;
    }
  }

  return Array.from(map.values()).sort((a, b) => new Date(b.lastPlayedAt).getTime() - new Date(a.lastPlayedAt).getTime());
}

function DetailList({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;

  return (
    <div className="analysis-detail-block">
      <span className="metric-label">{title}</span>
      <ul className="analysis-detail-list">
        {items.map((item) => (
          <li key={`${title}-${item}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function HistoryVoiceBlock({
  title,
  transcript,
  audioUrl,
}: {
  title: string;
  transcript?: string;
  audioUrl?: string;
}) {
  return (
    <div className="summary-transcript-block">
      <span className="metric-label">{title}</span>
      {audioUrl ? (
        <audio controls preload="none" className="summary-audio-player" src={audioUrl} />
      ) : (
        <p className="admin-message">No saved audio.</p>
      )}
      <p className="admin-transcript-preview summary-transcript-text">{transcript || 'No transcript captured.'}</p>
    </div>
  );
}

function LearnerStatsCard({ learner }: { learner: LearnerStats }) {
  const avgCvrRaw = average(learner.cvrRawTotal, learner.captainRounds);
  const avgCvrScore = average(learner.cvrScoreTotal, learner.captainRounds);
  const avgCci = average(learner.cciTotal, learner.crewRounds);
  const avgCpd = average(learner.cpdScoreTotal, learner.cpdCount);

  return (
    <article className="soft-card history-card-minimal">
      <div className="analysis-topline history-card-topline">
        <div className="history-topline-copy">
          <span className="soft-label">Learner</span>
          <p className="history-reason-preview">{learner.name}</p>
        </div>
        <span className="analysis-pill decision-match">
          {learner.captainRounds + learner.crewRounds} role turn(s)
        </span>
      </div>

      <div className="history-metric-row history-metric-row-compact">
        <div>
          <span className="metric-label">Captain rounds</span>
          <span className="metric-value">{learner.captainRounds}</span>
        </div>
        <div>
          <span className="metric-label">Crew rounds</span>
          <span className="metric-value">{learner.crewRounds}</span>
        </div>
        <div>
          <span className="metric-label metric-cvr">avg CVR (Ω)</span>
          <span className="metric-value metric-cvr">{formatAverage(avgCvrRaw, ' Ω')}</span>
        </div>
        <div>
          <span className="metric-label metric-cvr">avg CVR score</span>
          <span className="metric-value metric-cvr">{formatAverage(avgCvrScore)}</span>
        </div>
        <div>
          <span className="metric-label metric-cci">avg CCI (A)</span>
          <span className="metric-value metric-cci">{formatAverage(avgCci, ' A')}</span>
        </div>
        <div>
          <span className="metric-label metric-cpd">avg CPD (V)</span>
          <span className="metric-value metric-cpd">{formatAverage(avgCpd, ' V')}</span>
        </div>
      </div>
    </article>
  );
}

function HistoryCard({ round }: { round: RoundRecord }) {
  const [expanded, setExpanded] = useState(false);

  const createdLabel = useMemo(() => new Date(round.createdAt).toLocaleString(), [round.createdAt]);
  const shortReason = useMemo(() => {
    const reason = round.evaluation?.reason || 'No evaluation summary available.';
    if (reason.length <= 96) return reason;
    return `${reason.slice(0, 96).trim()}…`;
  }, [round.evaluation?.reason]);

  return (
    <article className={`soft-card history-card-minimal ${expanded ? 'is-expanded' : ''}`}>
      <div className="analysis-topline history-card-topline">
        <div className="history-topline-copy">
          <span className="soft-label">{createdLabel}</span>
          <p className="history-reason-preview">{shortReason}</p>
        </div>
        <div className="history-topline-actions">
          <span className={`analysis-pill decision-${round.evaluation?.decision || 'mismatch'}`}>
            {round.evaluation?.decision || round.state}
          </span>
          <button
            type="button"
            className="ghost-pill-button history-expand-button"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
          >
            {expanded ? 'Hide details' : 'View details'}
          </button>
        </div>
      </div>

      <div className="history-metric-row history-metric-row-compact">
        <div>
          <span className="metric-label metric-cci">CCI ({round.metrics?.cci.unit || 'A'})</span>
          <span className="metric-value metric-cci">{round.metrics?.cci.score != null ? formatMetricValue(round.metrics.cci.score, 1, ` ${round.metrics.cci.unit}`) : formatScorePercent(round.evaluation?.matchScore)}</span>
        </div>
        <div>
          <span className="metric-label metric-cvr">CVR ({round.metrics?.cvr.unit || 'Ω'})</span>
          <span className="metric-value metric-cvr">{round.metrics?.cvr.rawUnits != null ? formatMetricValue(round.metrics.cvr.rawUnits, 1, ` ${round.metrics.cvr.unit}`) : '—'}</span>
        </div>
        <div>
          <span className="metric-label metric-cpd">CPD ({round.metrics?.cpd.unit || 'V'})</span>
          <span className="metric-value metric-cpd">{round.metrics?.cpd.raw != null ? formatMetricValue(round.metrics.cpd.raw, 1, ` ${round.metrics.cpd.unit}`) : round.metrics?.cpd.score != null ? formatMetricValue(round.metrics.cpd.score, 1, ` ${round.metrics.cpd.unit}`) : '—'}</span>
        </div>
        <div>
          <span className="metric-label">delay</span>
          <span className="metric-value">{round.reactionDelayMs != null ? `${(round.reactionDelayMs / 1000).toFixed(2)}s` : '—'}</span>
        </div>
      </div>

      {expanded && (
        <div className="history-expanded-block">
          <div className="history-two-up">
            <HistoryVoiceBlock
              title={`Captain${round.captainName ? ` · ${round.captainName}` : ''} · Vietnamese`}
              transcript={round.captainTranscript?.transcript}
              audioUrl={round.captainAudioUrl}
            />
            <HistoryVoiceBlock
              title={`Crew${round.crewName ? ` · ${round.crewName}` : ''} · English`}
              transcript={round.crewTranscript?.transcript}
              audioUrl={round.crewAudioUrl}
            />
          </div>

          <div className="analysis-detail-block">
            <span className="metric-label">CCI meaning analysis</span>
            <p className="analysis-reason">{round.evaluation?.reason || 'No evaluation summary available.'}</p>
            {round.metrics?.cci && (
              <p className="admin-message">Saved formula: {round.metrics.cci.card?.label || '1-on-1'} ({formatMetricValue(round.metrics.cci.card?.baseA, 1)}A) × (MSE {formatMetricValue(round.metrics.cci.mse.coefficient, 1)} + Semantics decimal {formatMetricValue((round.metrics.cci.llmMeaningPercent || 0) / 100, 2)}) = {formatMetricValue(round.metrics.cci.current, 1)}A.</p>
            )}
          </div>

          <div className="analysis-grid-two-up">
            <DetailList title="missing meaning" items={round.evaluation?.missingConcepts} />
            <DetailList title="extra meaning" items={round.evaluation?.extraConcepts} />
          </div>
        </div>
      )}
    </article>
  );
}

export default function HistoryPage() {
  const [rounds, setRounds] = useState<RoundRecord[]>(() => loadCachedRounds());
  const [refreshing, setRefreshing] = useState(false);
  const learnerStats = useMemo(() => buildLearnerStats(rounds), [rounds]);

  useEffect(() => {
    setRefreshing(true);
    loadRecentRounds()
      .then(setRounds)
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  }, []);

  return (
    <main className="screen-shell admin-shell">
      <header className="page-header">
        <div>
          <p className="page-kicker">History</p>
          <h1 className="page-title">Learner stats</h1>
          <p className="muted-copy">Compare each learner by Captain CVR, Crew CCI, and shared CPD.{refreshing ? ' Refreshing…' : ''}</p>
        </div>
      </header>

      <section className="history-list-minimal">
        {learnerStats.length === 0 && <p className="muted-copy">No learner statistics yet. Play a round after saving Captain/Crew names.</p>}
        {learnerStats.map((learner) => (
          <LearnerStatsCard key={learner.key} learner={learner} />
        ))}
      </section>

      <header className="page-header" style={{ marginTop: 10 }}>
        <div>
          <p className="page-kicker">Rounds</p>
          <h2 className="section-title">Recent rounds</h2>
        </div>
      </header>

      <div className="history-list-minimal">
        {rounds.length === 0 && <p className="muted-copy">No rounds yet.</p>}
        {rounds.map((round) => (
          <HistoryCard key={round.id} round={round} />
        ))}
      </div>
    </main>
  );
}
