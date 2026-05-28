import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ResultCard } from '@/components/ResultCard';
import { useRoundContext } from '@/context/RoundContext';
import { resolveCrewResponseCoefficient } from '@/hooks/useCaptionCrewRound';
import { OhmChunkResult, RoundMetrics, TranscriptResult } from '@/types';

function formatConfidence(confidence?: number) {
  if (typeof confidence !== 'number' || Number.isNaN(confidence) || confidence <= 0) return '—';
  return `${Math.round(confidence * 100)}%`;
}

function formatDuration(duration?: number) {
  if (typeof duration !== 'number' || Number.isNaN(duration) || duration <= 0) return '—';
  return `${duration.toFixed(1)}s`;
}

function formatReactionDelay(delayMs: number | null) {
  if (typeof delayMs !== 'number' || Number.isNaN(delayMs) || delayMs < 0) return '—';
  return `${(delayMs / 1000).toFixed(2)}s`;
}

function getTranscriptPlaceholder(transcript?: TranscriptResult | null) {
  if (!transcript) return 'No transcript captured.';
  if (transcript.transcript?.trim()) return transcript.transcript;
  return 'Audio was saved, but no speech was recognized.';
}


function formatMetricNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return Number(value.toFixed(digits)).toString();
}

function MetricLoadingValue({ className = '', text = 'đang tính…' }: { className?: string; text?: string }) {
  return (
    <span className={`metric-value metric-loading-value ${className}`}>
      <span className="metric-mini-spinner" aria-hidden="true" />
      <span>{text}</span>
    </span>
  );
}

function SummaryOhmCard({
  totalOhm,
  current,
  chunks,
  reactionDelayMs,
  metrics,
  onSaveMse,
}: {
  totalOhm: number;
  current: number;
  chunks: OhmChunkResult[];
  reactionDelayMs: number | null;
  metrics?: RoundMetrics | null;
  onSaveMse?: (mseCoefficient: number) => Promise<void>;
}) {
  const [mseCoefficient, setMseCoefficient] = useState(metrics?.cci.mse.coefficient ?? 1);
  const [savingMse, setSavingMse] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const hasCvrMetric = typeof metrics?.cvr.rawUnits === 'number';
  const hasCciMetric = typeof metrics?.cci.llmMeaningPercent === 'number';
  const hasCpdMetric = Boolean(metrics?.cpd);
  const cvr = metrics?.cvr.rawUnits ?? totalOhm;
  const estimatedTC = metrics?.cvr.estimatedTC ?? chunks.reduce((sum, chunk) => sum + Number(chunk.ohm || 0), 0);
  const lc = metrics?.cvr.linguisticComplexity ?? metrics?.cvr.lengthCoefficient ?? current;
  const responseCoefficient = metrics?.cvr.responseTimeCoefficient ?? metrics?.cvr.responseCoefficient ?? resolveCrewResponseCoefficient(reactionDelayMs);
  const repeatCoefficient = metrics?.cvr.repeatCoefficient ?? 1;
  const denominator = Math.max(estimatedTC * lc * responseCoefficient * repeatCoefficient, 0.0001);
  const tl = metrics?.cvr.tensionLoad ?? (cvr > 0 && estimatedTC > 0 ? cvr / denominator : 1);
  const meaningPercent = metrics?.cci.llmMeaningPercent ?? 0;
  const meaningDecimal = meaningPercent / 100;
  const cardBaseA = metrics?.cci.card?.baseA ?? 10;
  const cardLabel = metrics?.cci.card?.label || '1-on-1';
  const cciCurrent = cardBaseA * meaningDecimal * Math.max(0, Number(mseCoefficient || 0));
  const cpd = cciCurrent * cvr;

  useEffect(() => {
    setMseCoefficient(metrics?.cci.mse.coefficient ?? 1);
  }, [metrics?.cci.mse.coefficient, metrics?.cci.card?.id]);

  const handleSaveMse = async () => {
    if (!onSaveMse) return;
    setSavingMse(true);
    setSaveMessage(null);
    try {
      await onSaveMse(Math.max(0, Number(mseCoefficient || 0)));
      setSaveMessage('Saved to round metrics.');
    } catch (error: any) {
      setSaveMessage(error?.message || 'Could not save MSE.');
    } finally {
      setSavingMse(false);
    }
  };

  return (
    <section className="soft-card admin-section-minimal metric-formula-card">
      <div className="summary-voice-header">
        <div>
          <p className="page-kicker summary-voice-kicker">Chunks Law breakdown</p>
          <h2 className="section-title metric-system-title"><span className="metric-cvr">CVR (Ω)</span> · <span className="metric-cci">CCI (A)</span> · <span className="metric-cpd">CPD (V)</span></h2>
        </div>
      </div>

      <div className="metric-formula-hero metric-cvr">
        <span className="metric-label metric-title metric-cvr">CVR ({metrics?.cvr.unit || 'Ω'})</span>
        {hasCvrMetric ? (
          <span className="metric-value metric-formula-value">{formatMetricNumber(cvr)} {metrics?.cvr.unit || 'Ω'}</span>
        ) : (
          <MetricLoadingValue className="metric-cvr metric-formula-value" text="đang tính CVR…" />
        )}
        <span className="metric-formula-detail">
          {hasCvrMetric
            ? `detail: ${formatMetricNumber(estimatedTC)} (TC) × ${formatMetricNumber(lc)} (LC) × ${formatMetricNumber(tl)} (TL) × ${formatMetricNumber(responseCoefficient)} (RT) × ${formatMetricNumber(repeatCoefficient)} (RC) = ${formatMetricNumber(cvr)} Ω`
            : 'đang chờ CVR measure trả kết quả…'}
        </span>
      </div>

      <div className="analysis-metrics summary-inline-metrics">
        <div className="metric-primary-cci">
          <span className="metric-label metric-title metric-cci">CCI ({metrics?.cci.unit || 'A'}) = CCI cards × MSE × Semantics</span>
          {hasCciMetric ? (
            <span className="metric-value metric-cci metric-cci-formula">
              {formatMetricNumber(cardBaseA, 2)} × {formatMetricNumber(Number(mseCoefficient || 0), 2)} × {formatMetricNumber(meaningDecimal, 4)} = {formatMetricNumber(cciCurrent, 4)}{metrics?.cci.unit || 'A'}
            </span>
          ) : (
            <MetricLoadingValue className="metric-cci" text="đang tính CCI…" />
          )}
          <div className="metric-cci-meta-row metric-cci-meta-row-3up">
            <div className="metric-secondary-cci">
              <span className="metric-label metric-cci">CCI card</span>
              <span className="metric-value metric-cci">{cardLabel} · {formatMetricNumber(cardBaseA)}A</span>
            </div>
            <div className="metric-secondary-cci">
              <span className="metric-label metric-cci">Semantics</span>
              {hasCciMetric ? (
                <span className="metric-value metric-cci">{formatMetricNumber(meaningPercent)}%</span>
              ) : (
                <MetricLoadingValue className="metric-cci" text="đang tính Semantics…" />
              )}
            </div>
            <label className="field-stack metric-mse-input metric-mse-inline">
              <span>MSE</span>
              <input
                type="number"
                min="0"
                step="0.05"
                value={mseCoefficient}
                onChange={(event) => setMseCoefficient(Number(event.target.value))}
              />
              <button type="button" className="ghost-pill-button metric-mse-save" onClick={() => void handleSaveMse()} disabled={savingMse || !onSaveMse || !hasCciMetric || !hasCvrMetric}>
                {savingMse ? 'Saving…' : 'Apply / Save'}
              </button>
            </label>
          </div>
          {saveMessage && <p className="admin-message metric-save-message">{saveMessage}</p>}
        </div>
        <div className="metric-primary-cpd">
          <span className="metric-label metric-title metric-cpd">CPD ({metrics?.cpd.unit || 'V'})</span>
          {hasCvrMetric && hasCciMetric && hasCpdMetric ? (
            <span className="metric-value metric-cpd">
              {formatMetricNumber(cciCurrent, 4)}{metrics?.cci.unit || 'A'} × {formatMetricNumber(cvr)}Ω = {formatMetricNumber(cpd)}{metrics?.cpd.unit || 'V'}
            </span>
          ) : (
            <MetricLoadingValue className="metric-cpd" text="đang tính CPD…" />
          )}
        </div>
        <div>
          <span className="metric-label">reaction delay</span>
          <span className="metric-value">{formatReactionDelay(reactionDelayMs)}</span>
        </div>
        <div>
          <span className="metric-label">repeat coefficient</span>
          <span className="metric-value">{formatMetricNumber(repeatCoefficient)} <small className="muted-copy">default</small></span>
        </div>
      </div>

      <div className="summary-transcript-block">
        <span className="metric-label">detected chunks</span>
        {chunks.length === 0 ? (
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

function SummaryVoiceCard({
  title,
  subtitle,
  transcript,
  audioUrl,
}: {
  title: string;
  subtitle: string;
  transcript?: TranscriptResult | null;
  audioUrl: string | null;
}) {
  return (
    <section className="soft-card admin-section-minimal summary-voice-card">
      <div className="summary-voice-header">
        <div>
          <p className="page-kicker summary-voice-kicker">{title}</p>
          <h2 className="section-title">{subtitle}</h2>
        </div>
        <div className="analysis-metrics summary-inline-metrics">
          <div>
            <span className="metric-label">confidence</span>
            <span className="metric-value">{formatConfidence(transcript?.confidence)}</span>
          </div>
          <div>
            <span className="metric-label">duration</span>
            <span className="metric-value">{formatDuration(transcript?.duration)}</span>
          </div>
        </div>
      </div>

      <div className="summary-audio-block">
        <span className="metric-label">saved audio</span>
        {audioUrl ? (
          <audio controls preload="metadata" className="summary-audio-player" src={audioUrl} />
        ) : (
          <p className="admin-message">No saved audio available for this role.</p>
        )}
      </div>

      <div className="summary-transcript-block">
        <span className="metric-label">transcript</span>
        <p className="admin-transcript-preview summary-transcript-text">{getTranscriptPlaceholder(transcript)}</p>
      </div>
    </section>
  );
}

export default function AnalysisSummaryPage() {
  const navigate = useNavigate();
  const round = useRoundContext();
  const [captainAudioUrl, setCaptainAudioUrl] = useState<string | null>(null);
  const [crewAudioUrl, setCrewAudioUrl] = useState<string | null>(null);

  const hasContent = !!round.evaluation || !!round.feedbackError
    || !!round.captainTranscript || !!round.ohmResult;

  useEffect(() => {
    if (round.captainAudioUrl) {
      setCaptainAudioUrl(round.captainAudioUrl);
      return undefined;
    }
    if (!round.captainAudioBlob) {
      setCaptainAudioUrl(null);
      return undefined;
    }

    const url = URL.createObjectURL(round.captainAudioBlob);
    setCaptainAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [round.captainAudioBlob, round.captainAudioUrl]);

  useEffect(() => {
    if (round.crewAudioUrl) {
      setCrewAudioUrl(round.crewAudioUrl);
      return undefined;
    }
    if (!round.crewAudioBlob) {
      setCrewAudioUrl(null);
      return undefined;
    }

    const url = URL.createObjectURL(round.crewAudioBlob);
    setCrewAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [round.crewAudioBlob, round.crewAudioUrl]);

  if (!hasContent) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="screen-shell admin-shell summary-screen">
      <header className="page-header brand-header">
        <div className="chunks-brand-block summary-brand-block">
          <img src="/chunks-logo.png" alt="Chunks" className="chunks-logo summary-logo" />
          <div>
            <p className="page-kicker">Round summary</p>
            <h1 className="page-title">CC FACE OFF</h1>
          </div>
        </div>
      </header>

      {round.feedbackError && (
        <section className="soft-card admin-section-minimal">
          <p className="game-error summary-error">{round.feedbackError}</p>
          <div className="action-row">
            <button
              type="button"
              className="primary-pill-button"
              onClick={() => {
                round.resetRound();
                navigate('/', { replace: true });
              }}
            >
              Back to game
            </button>
          </div>
        </section>
      )}

      {(round.captainTranscript || round.crewTranscript || round.captainAudioBlob || round.crewAudioBlob) && (
        <section className="summary-two-up">
          <SummaryVoiceCard
            title="Vietnamese input"
            subtitle={`Captain${round.captainName ? ` · ${round.captainName}` : ''}`}
            transcript={round.captainTranscript}
            audioUrl={captainAudioUrl}
          />
          <SummaryVoiceCard
            title="English response"
            subtitle={`Crew${round.crewName ? ` · ${round.crewName}` : ''}`}
            transcript={round.crewTranscript}
            audioUrl={crewAudioUrl}
          />
        </section>
      )}

      {round.ohmResult && (
        <SummaryOhmCard
          totalOhm={round.ohmResult.totalOhm}
          current={round.ohmResult.current}
          chunks={round.ohmResult.chunks}
          reactionDelayMs={round.reactionDelayMs}
          metrics={round.metrics || null}
          onSaveMse={async (mseCoefficient) => {
            await round.saveSummaryMse(mseCoefficient);
          }}
        />
      )}

      {round.evaluation ? (
        <ResultCard
          evaluation={round.evaluation}
          reactionDelayMs={round.reactionDelayMs}
          onReset={() => {
            round.resetRound();
            navigate('/', { replace: true });
          }}
        />
      ) : !round.feedbackError && (
        <section className="soft-card admin-section-minimal analysis-loading-card">
          <div className="spiral-loader" aria-hidden="true">
            <span className="spiral-ring spiral-ring-blue" />
            <span className="spiral-ring spiral-ring-red" />
            <span className="spiral-core" />
          </div>
          <p className="analysis-overlay-title">đang phân tích meaning</p>
          <p className="analysis-overlay-subtitle">CCI · CPD đang được tính toán</p>
        </section>
      )}
    </main>
  );
}
