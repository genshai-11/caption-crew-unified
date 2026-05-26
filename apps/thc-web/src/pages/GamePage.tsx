import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Users, X } from 'lucide-react';
import { RolePanel } from '@/components/RolePanel';
import { useRoundContext } from '@/context/RoundContext';

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
  const round = useRoundContext();
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
      navigate('/summary', { replace: true });
    }
  }, [navigate, round.state]);

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
        <section className="soft-card admin-section-minimal learner-compact-bar">
          <div className="learner-compact-side learner-compact-side-left">
            <span className="soft-label learner-compact-role learner-compact-role-captain">Captain</span>
            <div className="learner-compact-name learner-compact-name-captain">{round.captainName}</div>
          </div>
          <div className="learner-compact-actions" aria-label="Learner actions">
            <button
              type="button"
              className="ghost-pill-button icon-only-button"
              onClick={() => round.swapRoles()}
              disabled={!canEditLearners}
              title="Swap roles"
              aria-label="Swap roles"
            >
              <RefreshCw size={18} />
            </button>
            <button
              type="button"
              className="ghost-pill-button icon-only-button"
              onClick={() => setEditingLearners(true)}
              disabled={!canEditLearners}
              title="Change learners"
              aria-label="Change learners"
            >
              <Users size={18} />
            </button>
            {canEndRound && (
              <button
                type="button"
                className="ghost-pill-button icon-only-button"
                onClick={endRound}
                title="End round"
                aria-label="End round"
              >
                <X size={18} />
              </button>
            )}
          </div>
          <div className="learner-compact-side learner-compact-side-right">
            <span className="soft-label learner-compact-role learner-compact-role-crew">Crew</span>
            <div className="learner-compact-name learner-compact-name-crew">{round.crewName}</div>
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
