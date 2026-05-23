import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ResultCard } from '@/components/ResultCard';
import { OhmChunkResult, SummaryLocationState, TranscriptResult } from '@/types';

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
  return `${Math.round(delayMs)} ms (${(delayMs / 1000).toFixed(2)}s)`;
}

function formatSource(transcript?: TranscriptResult | null) {
  if (!transcript?.source) return '—';
  if (transcript.source === 'streaming') return 'live streaming';
  if (transcript.source === 'streaming-fallback-batch') return 'batch fallback';
  return transcript.source;
}

function getTranscriptPlaceholder(transcript?: TranscriptResult | null) {
  if (!transcript) return 'No transcript captured.';
  if (transcript.transcript?.trim()) return transcript.transcript;
  return 'Audio was saved, but no speech was recognized.';
}


function resolveCrewResponseCoefficient(delayMs: number | null) {
  if (typeof delayMs !== 'number' || Number.isNaN(delayMs) || delayMs <= 2000) return 1;
  if (delayMs >= 5000) return 1 / 3;
  const ratio = (delayMs - 2000) / 3000;
  return 1 - ratio * (2 / 3);
}

function SummaryOhmCard({
  totalOhm,
  current,
  chunks,
  reactionDelayMs,
}: {
  totalOhm: number;
  current: number;
  chunks: OhmChunkResult[];
  reactionDelayMs: number | null;
}) {
  const responseCoefficient = resolveCrewResponseCoefficient(reactionDelayMs);
  return (
    <section className="soft-card admin-section-minimal">
      <div className="summary-voice-header">
        <div>
          <p className="page-kicker summary-voice-kicker">Semantic Ohm</p>
          <h2 className="section-title">Total Ohm</h2>
        </div>
      </div>

      <div className="analysis-metrics summary-inline-metrics">
        <div>
          <span className="metric-label">total ohm</span>
          <span className="metric-value">{totalOhm} Ω</span>
        </div>
        <div>
          <span className="metric-label">(length coefficient)</span>
          <span className="metric-value">{current.toFixed(2)}</span>
        </div>
        <div>
          <span className="metric-label">(crew response coefficient)</span>
          <span className="metric-value">{responseCoefficient.toFixed(2)}</span>
        </div>
        <div>
          <span className="metric-label">reaction delay</span>
          <span className="metric-value">{formatReactionDelay(reactionDelayMs)}</span>
        </div>
      </div>

      <p className="admin-message" style={{ marginTop: 8 }}>
        Linear rule: ≤2.0s → 1.00, ≥5.0s → 0.33, and 2.0s–5.0s decreases linearly.
      </p>

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
          <div>
            <span className="metric-label">source</span>
            <span className="metric-value">{formatSource(transcript)}</span>
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
  const location = useLocation();
  const navigate = useNavigate();
  const summary = (location.state || null) as SummaryLocationState | null;
  const [captainAudioUrl, setCaptainAudioUrl] = useState<string | null>(null);
  const [crewAudioUrl, setCrewAudioUrl] = useState<string | null>(null);

  const hasContent = useMemo(() => !!summary?.evaluation || !!summary?.errorMessage, [summary]);

  useEffect(() => {
    if (summary?.captainAudioUrl) {
      setCaptainAudioUrl(summary.captainAudioUrl);
      return undefined;
    }
    if (!summary?.captainAudioBlob) {
      setCaptainAudioUrl(null);
      return undefined;
    }

    const url = URL.createObjectURL(summary.captainAudioBlob);
    setCaptainAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [summary?.captainAudioBlob, summary?.captainAudioUrl]);

  useEffect(() => {
    if (summary?.crewAudioUrl) {
      setCrewAudioUrl(summary.crewAudioUrl);
      return undefined;
    }
    if (!summary?.crewAudioBlob) {
      setCrewAudioUrl(null);
      return undefined;
    }

    const url = URL.createObjectURL(summary.crewAudioBlob);
    setCrewAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [summary?.crewAudioBlob, summary?.crewAudioUrl]);

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

      {summary?.errorMessage && (
        <section className="soft-card admin-section-minimal">
          <p className="game-error summary-error">{summary.errorMessage}</p>
          <div className="action-row">
            <button type="button" className="primary-pill-button" onClick={() => navigate('/', { replace: true })}>
              Back to game
            </button>
          </div>
        </section>
      )}

      {(summary?.captainTranscript || summary?.crewTranscript || summary?.captainAudioBlob || summary?.crewAudioBlob) && (
        <section className="summary-two-up">
          <SummaryVoiceCard
            title="Component 1"
            subtitle="Captain · Vietnamese input"
            transcript={summary?.captainTranscript}
            audioUrl={captainAudioUrl}
          />
          <SummaryVoiceCard
            title="Component 2"
            subtitle="Crew · English response"
            transcript={summary?.crewTranscript}
            audioUrl={crewAudioUrl}
          />
        </section>
      )}

      {summary?.ohmResult && (
        <SummaryOhmCard
          totalOhm={summary.ohmResult.totalOhm}
          current={summary.ohmResult.current}
          chunks={summary.ohmResult.chunks}
          reactionDelayMs={summary.reactionDelayMs}
        />
      )}

      {summary?.evaluation && (
        <ResultCard
          evaluation={summary.evaluation}
          reactionDelayMs={summary.reactionDelayMs}
          onReset={() => navigate('/', { replace: true })}
        />
      )}
    </main>
  );
}
