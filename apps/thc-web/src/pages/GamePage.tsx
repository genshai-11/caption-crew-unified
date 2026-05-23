import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { RolePanel } from '@/components/RolePanel';
import { useCaptionCrewRound } from '@/hooks/useCaptionCrewRound';
import { SummaryLocationState } from '@/types';

function formatCountdown(ms: number | null) {
  if (ms == null) return '';
  return `${(ms / 1000).toFixed(1)}s left`;
}

function getOverlayCopy(state: string) {
  if (state === 'crew-processing') {
    return { title: 'finalizing live transcript', subtitle: 'wrapping up the last spoken words before analysis starts' };
  }
  if (state === 'evaluating') {
    return { title: 'analyzing meaning', subtitle: 'comparing the finalized transcript without waiting for full batch stt' };
  }
  return null;
}

export default function GamePage() {
  const navigate = useNavigate();
  const round = useCaptionCrewRound();
  const overlay = getOverlayCopy(round.state);

  useEffect(() => {
    if (round.state === 'results' || round.state === 'crew-timeout') {
      if (round.evaluation || round.feedbackError) {
        const summaryState: SummaryLocationState = {
          evaluation: round.evaluation,
          reactionDelayMs: round.reactionDelayMs,
          errorMessage: round.feedbackError,
          captainTranscript: round.captainTranscript,
          crewTranscript: round.crewTranscript,
          captainVerifiedTranscript: round.captainVerifiedTranscript,
          crewVerifiedTranscript: round.crewVerifiedTranscript,
          ohmResult: round.ohmResult,
          captainAudioBlob: round.captainAudioBlob,
          crewAudioBlob: round.crewAudioBlob,
          captainAudioUrl: round.captainAudioUrl,
          crewAudioUrl: round.crewAudioUrl,
        };

        navigate('/summary', {
          replace: true,
          state: summaryState,
        });
      }
    }
  }, [
    navigate,
    round.captainAudioBlob,
    round.captainAudioUrl,
    round.captainTranscript,
    round.captainVerifiedTranscript,
    round.crewAudioBlob,
    round.crewAudioUrl,
    round.crewTranscript,
    round.crewVerifiedTranscript,
    round.ohmResult,
    round.evaluation,
    round.feedbackError,
    round.reactionDelayMs,
    round.state,
  ]);

  return (
    <main className="game-screen">
      <div className="game-header brand-header">
        <div className="chunks-brand-block">
          <img src="/chunks-logo.png" alt="Chunks" className="chunks-logo" />
          <div>
            <p className="game-kicker">Caption & Crew</p>
            <h1 className="game-title">CC FACE OFF</h1>
          </div>
        </div>
        {round.feedbackError && round.state !== 'results' && round.state !== 'crew-timeout' && <p className="game-error">{round.feedbackError}</p>}
      </div>

      <section className="playfield-shell">
        <RolePanel
          role="captain"
          title="Captain"
          color="red"
          recording={round.captainRecorder.isRecording}
          active={round.state === 'captain-ready' || round.state === 'captain-recording'}
          disabled={!round.canStartCaptain}
          processing={false}
          helperText={round.state === 'captain-ready' ? 'Speak in Vietnamese' : round.captainStreamingStatus}
          transcriptPreview={round.captainRecorder.isRecording || !!round.captainLiveTranscript ? round.captainLiveTranscript : undefined}
          levels={round.captainRecorder.levels}
          onStart={() => void round.startCaptain()}
          onStop={() => void round.stopCaptain()}
        />

        <RolePanel
          role="crew"
          title="Crew"
          color="blue"
          recording={round.crewRecorder.isRecording}
          active={round.state === 'crew-waiting' || round.state === 'crew-recording' || round.state === 'crew-processing' || round.state === 'evaluating'}
          disabled={!round.canStartCrew}
          processing={round.state === 'crew-processing' || round.state === 'evaluating'}
          countdownLabel={round.state === 'crew-waiting' ? formatCountdown(round.countdownMs) : undefined}
          helperText={round.state === 'crew-waiting' ? 'Reply in English before time runs out' : round.crewStreamingStatus}
          transcriptPreview={round.crewRecorder.isRecording || !!round.crewLiveTranscript ? round.crewLiveTranscript : undefined}
          levels={round.crewRecorder.levels}
          onStart={() => void round.startCrew()}
          onStop={() => void round.stopCrew()}
        />

        {round.state === 'crew-waiting' && round.countdownMs != null && (
          <div className="countdown-float">
            <span className="countdown-label">crew window</span>
            <span className="countdown-value">{(round.countdownMs / 1000).toFixed(1)}</span>
          </div>
        )}
      </section>

      {overlay && (
        <div className="analysis-overlay" role="status" aria-live="polite">
          <div className="spiral-loader" aria-hidden="true">
            <span className="spiral-ring spiral-ring-blue" />
            <span className="spiral-ring spiral-ring-red" />
            <span className="spiral-core" />
          </div>
          <p className="analysis-overlay-title">{overlay.title}</p>
          <p className="analysis-overlay-subtitle">{overlay.subtitle}</p>
        </div>
      )}
    </main>
  );
}
