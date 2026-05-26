import { useEffect, useState } from 'react';
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
  const [captainInput, setCaptainInput] = useState('');
  const [crewInput, setCrewInput] = useState('');
  const [editingLearners, setEditingLearners] = useState(false);

  useEffect(() => {
    setCaptainInput(round.captainName || '');
    setCrewInput(round.crewName || '');
  }, [round.captainName, round.crewName]);

  useEffect(() => {
    if (round.state === 'results' || round.state === 'crew-timeout') {
      if (round.evaluation || round.feedbackError) {
        const summaryState: SummaryLocationState = {
          evaluation: round.evaluation,
          reactionDelayMs: round.reactionDelayMs,
          errorMessage: round.feedbackError,
          captainPlayerId: round.captainPlayerId,
          crewPlayerId: round.crewPlayerId,
          captainName: round.captainName,
          crewName: round.crewName,
          captainTranscript: round.captainTranscript,
          crewTranscript: round.crewTranscript,
          captainVerifiedTranscript: round.captainVerifiedTranscript,
          crewVerifiedTranscript: round.crewVerifiedTranscript,
          ohmResult: round.ohmResult,
          metrics: round.metrics,
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
    round.captainName,
    round.captainPlayerId,
    round.captainTranscript,
    round.captainVerifiedTranscript,
    round.crewAudioBlob,
    round.crewAudioUrl,
    round.crewName,
    round.crewPlayerId,
    round.crewTranscript,
    round.crewVerifiedTranscript,
    round.ohmResult,
    round.metrics,
    round.evaluation,
    round.feedbackError,
    round.reactionDelayMs,
    round.state,
  ]);

  const canEditLearners = round.state === 'captain-ready';
  const canEndRound = round.rolesConfigured && round.state !== 'captain-ready';
  const showRoleSetup = !round.rolesConfigured || editingLearners;

  const saveRoles = () => {
    const saved = editingLearners
      ? round.replaceLearners(captainInput, crewInput)
      : round.saveRoleSetup(captainInput, crewInput);
    if (saved) setEditingLearners(false);
  };

  const endRound = () => {
    if (!window.confirm('End this round without saving it to History?')) return;
    round.endRound();
    setEditingLearners(false);
  };

  return (
    <main className="game-screen">
      <div className="game-header brand-header">
        <div className="chunks-brand-block">
          <img src="/chunks-logo.png" alt="Chunks" className="chunks-logo" />
          <div>
            <p className="game-kicker">captain & crew</p>
            <h1 className="game-title">CC FACE OFF</h1>
          </div>
        </div>
        {round.feedbackError && round.state !== 'results' && round.state !== 'crew-timeout' && <p className="game-error">{round.feedbackError}</p>}
      </div>

      {showRoleSetup ? (
        <section className="soft-card admin-section-minimal">
          <div>
            <p className="page-kicker">Role setup</p>
            <h2 className="section-title">{editingLearners ? 'Change learners' : 'Who is playing?'}</h2>
          </div>
          <p className="admin-message">{editingLearners ? 'Save new learners to start a fresh comparison identity. Existing history stays under the previous names/IDs.' : 'Enter learner names before playing so CVR / CCI / CPD rounds can be saved and compared by role.'}</p>
          <div className="admin-grid two-up">
            <label className="field-stack">
              <span>Captain name</span>
              <input value={captainInput} onChange={(e) => setCaptainInput(e.target.value)} placeholder="Captain / prompt giver" maxLength={40} />
            </label>
            <label className="field-stack">
              <span>Crew name</span>
              <input value={crewInput} onChange={(e) => setCrewInput(e.target.value)} placeholder="Crew / responder" maxLength={40} />
            </label>
          </div>
          <div className="action-row">
            <button type="button" className="primary-pill-button" onClick={saveRoles} disabled={!captainInput.trim() || !crewInput.trim()}>
              {editingLearners ? 'Save new learners' : 'Save roles'}
            </button>
            {editingLearners && (
              <button type="button" className="ghost-pill-button" onClick={() => setEditingLearners(false)}>
                Cancel
              </button>
            )}
          </div>
        </section>
      ) : (
        <section className="soft-card admin-section-minimal" style={{ padding: 16 }}>
          <div className="action-row" style={{ justifyContent: 'space-between' }}>
            <div>
              <span className="soft-label" style={{ color: 'var(--red)' }}>Captain</span>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--red)' }}>{round.captainName}</div>
            </div>
            <div className="action-row" style={{ justifyContent: 'center' }}>
              <button type="button" className="ghost-pill-button" onClick={() => round.swapRoles()} disabled={!canEditLearners}>
                Swap roles
              </button>
              <button type="button" className="ghost-pill-button" onClick={() => setEditingLearners(true)} disabled={!canEditLearners}>
                Change learners
              </button>
              {canEndRound && (
                <button type="button" className="ghost-pill-button" onClick={endRound}>
                  End round
                </button>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className="soft-label" style={{ color: 'var(--blue)' }}>Crew</span>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--blue)' }}>{round.crewName}</div>
            </div>
          </div>
        </section>
      )}

      {round.rolesConfigured && (
      <section className="playfield-shell">
        <RolePanel
          role="captain"
          title={round.captainName ? `Captain · ${round.captainName}` : 'Captain'}
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
          title={round.crewName ? `Crew · ${round.crewName}` : 'Crew'}
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
      )}

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
