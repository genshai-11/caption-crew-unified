import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ResultCard } from '@/components/ResultCard';
import { SummaryVoiceCard } from '@/components/SummaryVoiceCard';
import { SummaryOhmCard } from '@/components/SummaryOhmCard';
import { SummaryLocationState } from '@/types';

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
            <h1 className="page-title">Chunks Circle</h1>
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
            transcript={summary?.captainTranscript?.transcript || null}
            transcriptMeta={summary?.captainTranscript || null}
            audioUrl={captainAudioUrl}
          />
          <SummaryVoiceCard
            title="Component 2"
            subtitle="Crew · English response"
            transcript={summary?.crewTranscript?.transcript || null}
            transcriptMeta={summary?.crewTranscript || null}
            audioUrl={crewAudioUrl}
          />
        </section>
      )}

      <SummaryOhmCard
        ohmResult={summary?.ohmResult || null}
        reactionDelayMs={summary?.reactionDelayMs}
        metrics={summary?.metrics || null}
      />

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
