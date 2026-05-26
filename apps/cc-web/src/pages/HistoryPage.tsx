import { useEffect, useMemo, useState } from 'react';
import { loadRecentRounds } from '@/services/roundRepository';
import { RoundRecord } from '@/types';

function formatScorePercent(score?: number | null) {
  const numeric = Number(score ?? 0);
  if (!Number.isFinite(numeric)) return '0%';
  return `${Math.max(0, Math.min(100, Math.round(numeric)))}%`;
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
          <span className="metric-value metric-cci">{round.metrics?.cci.score != null ? `${round.metrics.cci.score} ${round.metrics.cci.unit}` : formatScorePercent(round.evaluation?.matchScore)}</span>
        </div>
        <div>
          <span className="metric-label metric-cvr">CVR ({round.metrics?.cvr.unit || 'Ω'})</span>
          <span className="metric-value metric-cvr">{round.metrics?.cvr.rawUnits != null ? `${round.metrics.cvr.rawUnits} ${round.metrics.cvr.unit}` : '—'}</span>
        </div>
        <div>
          <span className="metric-label metric-cpd">CPD ({round.metrics?.cpd.unit || 'V'})</span>
          <span className="metric-value metric-cpd">{round.metrics?.cpd.raw != null ? `${round.metrics.cpd.raw} ${round.metrics.cpd.unit}` : round.metrics?.cpd.score != null ? `${round.metrics.cpd.score} ${round.metrics.cpd.unit}` : '—'}</span>
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
              title="Captain · Vietnamese"
              transcript={round.captainTranscript?.transcript}
              audioUrl={round.captainAudioUrl}
            />
            <HistoryVoiceBlock
              title="Crew · English"
              transcript={round.crewTranscript?.transcript}
              audioUrl={round.crewAudioUrl}
            />
          </div>

          <div className="analysis-detail-block">
            <span className="metric-label">CCI meaning analysis</span>
            <p className="analysis-reason">{round.evaluation?.reason || 'No evaluation summary available.'}</p>
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
  const [rounds, setRounds] = useState<RoundRecord[]>([]);

  useEffect(() => {
    loadRecentRounds().then(setRounds).catch(() => undefined);
  }, []);

  return (
    <main className="screen-shell admin-shell">
      <header className="page-header">
        <div>
          <p className="page-kicker">History</p>
          <h1 className="page-title">Recent rounds</h1>
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
