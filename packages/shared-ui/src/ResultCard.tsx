import type { MeaningEvaluation } from '@caption-crew/shared-types';

interface ResultCardProps {
  evaluation: MeaningEvaluation | null;
  reactionDelayMs: number | null;
  onReset: () => void;
}

function formatScorePercent(score?: number | null) {
  const numeric = Number(score ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
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

export function ResultCard({ evaluation, reactionDelayMs, onReset }: ResultCardProps) {
  if (!evaluation) {
    return null;
  }

  const scorePercent = formatScorePercent(evaluation.matchScore);

  return (
    <section className="analysis-card">
      <div className="analysis-topline">
        <span className="analysis-label">llm meaning analysis</span>
        <span className={`analysis-pill decision-${evaluation.decision}`}>{evaluation.decision}</span>
      </div>

      <div className="analysis-score-block">
        <div className="analysis-score" aria-label={`meaning match ${scorePercent} percent`}>
          <span>{scorePercent}</span><span className="analysis-score-unit">%</span>
        </div>
        <div className="analysis-caption">meaning match · 100% scale</div>
      </div>

      <div className="analysis-metrics">
        <div>
          <span className="metric-label">response delay</span>
          <span className="metric-value">{reactionDelayMs != null ? `${(reactionDelayMs / 1000).toFixed(2)}s` : '—'}</span>
        </div>
        <div>
          <span className="metric-label">feedback mode</span>
          <span className="metric-value">{evaluation.feedbackType || 'off'}</span>
        </div>
      </div>

      <div className="analysis-detail-block">
        <span className="metric-label">summary</span>
        <p className="analysis-reason">{evaluation.reason}</p>
      </div>

      <div className="analysis-grid-two-up">
        <DetailList title="missing meaning" items={evaluation.missingConcepts} />
        <DetailList title="extra meaning" items={evaluation.extraConcepts} />
      </div>

      {(evaluation.grammarNote || evaluation.improvedTranscript) && (
        <div className="analysis-grid-two-up">
          {evaluation.grammarNote && (
            <div className="analysis-detail-block">
              <span className="metric-label">clarity note</span>
              <p className="analysis-reason">{evaluation.grammarNote}</p>
            </div>
          )}
          {evaluation.improvedTranscript && (
            <div className="analysis-detail-block">
              <span className="metric-label">suggested English</span>
              <p className="analysis-reason">{evaluation.improvedTranscript}</p>
            </div>
          )}
        </div>
      )}

      <button type="button" className="primary-pill-button" onClick={onReset}>
        Play again
      </button>
    </section>
  );
}
