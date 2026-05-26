import type { OhmChunkResult, OhmResult, RoundMetrics } from '@/types';

function formatReactionDelay(delayMs: number | null | undefined) {
  if (typeof delayMs !== 'number' || Number.isNaN(delayMs) || delayMs < 0) return '—';
  return `${Math.round(delayMs)} ms (${(delayMs / 1000).toFixed(2)}s)`;
}

export function SummaryOhmCard({
  ohmResult,
  reactionDelayMs,
  metrics,
}: {
  ohmResult?: OhmResult | null;
  reactionDelayMs?: number | null;
  metrics?: RoundMetrics | null;
}) {
  const totalOhm = Number(ohmResult?.totalOhm || 0);
  const current = Number(ohmResult?.current || 1);
  const formula = String(ohmResult?.formula || '—');
  const chunks: OhmChunkResult[] = Array.isArray(ohmResult?.chunks) ? ohmResult!.chunks : [];

  return (
    <section className="soft-card admin-section-minimal">
      <div className="summary-voice-header">
        <div>
          <p className="page-kicker summary-voice-kicker">Chunks Law breakdown</p>
          <h2 className="section-title metric-system-title"><span className="metric-cvr">CVR (Ω)</span> · <span className="metric-cci">CCI (A)</span> · <span className="metric-cpd">CPD (V)</span></h2>
        </div>
      </div>

      <div className="analysis-metrics summary-inline-metrics">
        <div>
          <span className="metric-label metric-title metric-cvr">CVR ({metrics?.cvr.unit || 'Ω'})</span>
          <span className="metric-value metric-cvr">{metrics?.cvr.rawUnits ?? totalOhm} {metrics?.cvr.unit || 'Ω'}</span>
        </div>
        <div>
          <span className="metric-label metric-title metric-cci">CCI ({metrics?.cci.unit || 'A'})</span>
          <span className="metric-value metric-cci">{metrics?.cci.score != null ? `${metrics.cci.score} ${metrics.cci.unit}` : '—'}</span>
        </div>
        <div>
          <span className="metric-label metric-title metric-cpd">CPD ({metrics?.cpd.unit || 'V'})</span>
          <span className="metric-value metric-cpd">{metrics?.cpd.raw != null ? `${metrics.cpd.raw} ${metrics.cpd.unit}` : metrics?.cpd.score != null ? `${metrics.cpd.score} ${metrics.cpd.unit}` : '—'}</span>
        </div>
        <div>
          <span className="metric-label">formula</span>
          <span className="metric-value">{formula}</span>
        </div>
        <div>
          <span className="metric-label">length coefficient</span>
          <span className="metric-value">{Number(current || 1).toFixed(2)}</span>
        </div>
        <div>
          <span className="metric-label">reaction delay</span>
          <span className="metric-value">{formatReactionDelay(reactionDelayMs)}</span>
        </div>
      </div>

      <div className="summary-transcript-block">
        <span className="metric-label">detected chunks</span>
        {!ohmResult ? (
          <p className="admin-message">CVR unavailable for this round. CCI meaning analysis may still have completed.</p>
        ) : chunks.length === 0 ? (
          <p className="admin-message">No chunks detected.</p>
        ) : (
          <ul className="analysis-detail-list">
            {chunks.map((chunk, idx) => (
              <li key={`${chunk.label}-${idx}-${chunk.text.slice(0, 16)}`}>
                <strong>{chunk.label}</strong> · {chunk.ohm} Ω · {chunk.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
