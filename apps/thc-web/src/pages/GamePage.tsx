import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Hand, RefreshCw, Users, Waves, X } from 'lucide-react';
import { RolePanel } from '@/components/RolePanel';
import { useRoundContext } from '@/context/RoundContext';
import { loadCachedRounds } from '@/services/roundRepository';
import type { RoundRecord } from '@/types';

function CciCardGlyph({ icon }: { icon: string }) {
  if (icon === 'hand') return <Hand size={16} />;
  if (icon === 'waves') return <Waves size={16} />;
  if (icon === 'blocks') {
    return (
      <span className="cci-log-glyph" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    );
  }
  return <Users size={16} />;
}

function formatCountdown(ms: number | null) {
  if (ms == null) return '';
  return `${(ms / 1000).toFixed(1)}s left`;
}

const TEAM_ANALYSIS_SINCE_KEY = 'caption-crew-team-analysis-since';

function loadTeamAnalysisSince() {
  try {
    const value = Number(sessionStorage.getItem(TEAM_ANALYSIS_SINCE_KEY) || 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function saveTeamAnalysisSince(value: number) {
  try {
    sessionStorage.setItem(TEAM_ANALYSIS_SINCE_KEY, String(value));
  } catch {
    // ignore
  }
}

function formatMetric(value: unknown, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return Number(numeric.toFixed(digits)).toString();
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
  const [cciMenuOpen, setCciMenuOpen] = useState(false);
  const [scoreSummaryOpen, setScoreSummaryOpen] = useState(false);
  const [historyRounds, setHistoryRounds] = useState<RoundRecord[]>(() => loadCachedRounds());
  const [teamAnalysisSinceMs, setTeamAnalysisSinceMs] = useState(() => loadTeamAnalysisSince());

  useEffect(() => {
    setCaptainInput(round.captainName || '');
    setCrewInput(round.crewName || '');
  }, [round.captainName, round.crewName]);

  useEffect(() => {
    if (round.state === 'results' || round.state === 'crew-timeout') {
      navigate('/summary', { replace: true });
    }
  }, [navigate, round.state]);

  useEffect(() => {
    if (round.state !== 'captain-ready') setCciMenuOpen(false);
  }, [round.state]);

  useEffect(() => {
    if (scoreSummaryOpen) setHistoryRounds(loadCachedRounds());
  }, [scoreSummaryOpen]);

  const teamAnalysis = useMemo(() => {
    const teamAName = round.captainName || 'Team A';
    const teamBName = round.crewName || 'Team B';
    const sameName = (a?: string | null, b?: string | null) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    const rowFromRound = (entry: RoundRecord, index: number) => {
      const teamARole = sameName(entry.captainName, teamAName) ? 'Captain' : sameName(entry.crewName, teamAName) ? 'Crew' : '—';
      const teamBRole = sameName(entry.captainName, teamBName) ? 'Captain' : sameName(entry.crewName, teamBName) ? 'Crew' : '—';
      const meaning = Number(entry.metrics?.cci.llmMeaningPercent ?? entry.evaluation?.matchScore ?? 0);
      const cvr = Number(entry.metrics?.cvr.rawUnits ?? entry.ohmResult?.totalOhm ?? 0);
      const cci = Number(entry.metrics?.cci.current ?? entry.metrics?.cci.score ?? 0);
      const cpd = Number(entry.metrics?.cpd.raw ?? entry.metrics?.cpd.score ?? 0);
      const teamAValue = teamARole === 'Crew' ? cpd : teamARole === 'Captain' ? cvr : 0;
      const teamBValue = teamBRole === 'Crew' ? cpd : teamBRole === 'Captain' ? cvr : 0;
      return {
        id: entry.id || `round-${index}`,
        label: `R${index + 1}`,
        teamARole,
        teamBRole,
        teamAValue,
        teamBValue,
        cvr,
        cci,
        cpd,
        meaning,
        mse: Number(entry.metrics?.cci.mse.coefficient ?? 0),
        card: entry.metrics?.cci.card?.label || 'CCI card',
      };
    };

    const matchingHistory = historyRounds
      .filter((entry) => {
        const createdAtMs = Date.parse(entry.createdAt || '');
        const isAfterReset = !teamAnalysisSinceMs || (Number.isFinite(createdAtMs) && createdAtMs >= teamAnalysisSinceMs);
        return isAfterReset &&
          (sameName(entry.captainName, teamAName) || sameName(entry.crewName, teamAName)) &&
          (sameName(entry.captainName, teamBName) || sameName(entry.crewName, teamBName));
      });

    const currentRound: RoundRecord | null = round.metrics ? {
      id: 'current-preview-round',
      createdAt: new Date().toISOString(),
      state: 'results',
      captainName: round.captainName || null,
      crewName: round.crewName || null,
      metrics: round.metrics,
      evaluation: round.evaluation || undefined,
      ohmResult: round.ohmResult || undefined,
      reactionDelayMs: round.reactionDelayMs || undefined,
      timeoutLost: false,
    } as RoundRecord : null;

    const sourceRounds = [
      ...(currentRound ? [currentRound] : []),
      ...matchingHistory.filter((entry) => entry.id !== currentRound?.id),
    ].slice(0, 8);
    const rows = sourceRounds.map(rowFromRound);
    const teamACpd = rows.filter((row) => row.teamARole === 'Crew').reduce((sum, row) => sum + row.cpd, 0);
    const teamBCpd = rows.filter((row) => row.teamBRole === 'Crew').reduce((sum, row) => sum + row.cpd, 0);
    const teamACvr = rows.filter((row) => row.teamARole === 'Captain').reduce((sum, row) => sum + row.cvr, 0);
    const teamBCvr = rows.filter((row) => row.teamBRole === 'Captain').reduce((sum, row) => sum + row.cvr, 0);
    const winnerName = teamACpd === teamBCpd ? 'Tie' : teamACpd > teamBCpd ? teamAName : teamBName;

    return { teamAName, teamBName, rows, teamACpd, teamBCpd, teamACvr, teamBCvr, winnerName, sinceMs: teamAnalysisSinceMs };
  }, [historyRounds, round.captainName, round.crewName, round.evaluation, round.metrics, round.ohmResult, round.reactionDelayMs, teamAnalysisSinceMs]);

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
            <div className="cci-card-menu-wrap">
              <button
                type="button"
                className="ghost-pill-button cci-card-trigger"
                onClick={() => {
                  setScoreSummaryOpen(false);
                  setCciMenuOpen((prev) => !prev);
                }}
                disabled={!canEditLearners}
                title={`${round.selectedCciCard.label} · ${round.selectedCciCard.baseA}A`}
                aria-label={`Selected CCI card ${round.selectedCciCard.label} ${round.selectedCciCard.baseA}A`}
                aria-expanded={cciMenuOpen}
              >
                <span className="cci-card-option-icon" aria-hidden="true"><CciCardGlyph icon={round.selectedCciCard.icon} /></span>
                <span className="cci-card-trigger-badge">{round.selectedCciCard.baseA}A</span>
              </button>
              <button
                type="button"
                className="ghost-pill-button icon-only-button team-score-trigger"
                onClick={() => {
                  setCciMenuOpen(false);
                  setScoreSummaryOpen((prev) => !prev);
                }}
                title="Team score summary"
                aria-label="Open team score summary"
                aria-expanded={scoreSummaryOpen}
              >
                <BarChart3 size={18} />
              </button>
              {scoreSummaryOpen && (
                <div className="team-score-popover" role="dialog" aria-label="Team score summary">
                  <div className="team-score-winner-strip">
                    <span className="soft-label">Winner by Crew CPD sum</span>
                    <strong>{teamAnalysis.winnerName}</strong>
                  </div>
                  <div className="team-score-popover-grid">
                    <div className="team-score-mini team-score-mini-captain">
                      <span className="soft-label">{teamAnalysis.teamAName}</span>
                      <strong>{formatMetric(teamAnalysis.teamACpd, 2)}V CPD</strong>
                      <p className="team-score-role-note team-score-role-crew">Crew turns score CPD</p>
                      <p className="team-score-role-note team-score-role-captain">Captain CVR sum: {formatMetric(teamAnalysis.teamACvr, 2)}Ω</p>
                    </div>
                    <div className="team-score-mini team-score-mini-crew">
                      <span className="soft-label">{teamAnalysis.teamBName}</span>
                      <strong>{formatMetric(teamAnalysis.teamBCpd, 2)}V CPD</strong>
                      <p className="team-score-role-note team-score-role-crew">Crew turns score CPD</p>
                      <p className="team-score-role-note team-score-role-captain">Captain CVR sum: {formatMetric(teamAnalysis.teamBCvr, 2)}Ω</p>
                    </div>
                  </div>
                  <div className="team-score-card-analysis">
                    <span className="soft-label">Card analysis rule</span>
                    <strong>Higher sum CPD = winner</strong>
                    <p><b>Captain / Hitter:</b> creates Initial CVR (Ω). Auto lose if CVR is outside the valid 1–50Ω range.</p>
                    <p><b>Crew / Thrower & catcher:</b> creates Real CCI (A) = (Semantics% + MSE%) × fixed CCI card.</p>
                    <p><b>Round CPD:</b> Initial CVR × Real CCI = CPD (V). Team totals compare summed CPD from Crew turns.</p>
                    <p><b>Auto win:</b> Semantics = 100% and MSE = 100%. Auto win/lose is checked per player, then affects the team total.</p>
                    <p>Fixed CCI card: {round.metrics?.cci.card?.label || round.selectedCciCard.label} · {round.metrics?.cci.card?.baseA ?? round.selectedCciCard.baseA}A · MSE {round.metrics?.cci.mse.coefficient ?? '—'} · Semantics {round.metrics?.cci.llmMeaningPercent != null ? `${round.metrics.cci.llmMeaningPercent}% → ${formatMetric(round.metrics.cci.llmMeaningPercent / 100, 4)}` : '—'}</p>
                  </div>
                  <div className="action-row team-score-actions">
                    <button
                      type="button"
                      className="primary-pill-button team-score-new-round"
                      onClick={() => {
                        const nextSince = Date.now();
                        saveTeamAnalysisSince(nextSince);
                        setTeamAnalysisSinceMs(nextSince);
                        setHistoryRounds([]);
                        round.resetRound({ preserveSelectedCciCard: true });
                        setScoreSummaryOpen(false);
                        setCciMenuOpen(false);
                      }}
                    >
                      <RefreshCw size={14} aria-hidden="true" />
                      New round — same teams
                    </button>
                  </div>
                  <div className="team-round-detail-list">
                    <span className="soft-label">Round details</span>
                    {teamAnalysis.rows.length === 0 ? (
                      <p className="admin-message">Round details were reset for this same-team session. Finish the next round to see fresh Team A/B CPD, role, CVR, CCI and CPD details.</p>
                    ) : teamAnalysis.rows.map((entry) => (
                      <div key={entry.id} className="team-round-detail-row">
                        <strong>{entry.label}</strong>
                        <div className="team-round-role-grid">
                          <div className={`team-round-role-card ${entry.teamARole === 'Captain' ? 'is-captain' : entry.teamARole === 'Crew' ? 'is-crew' : ''}`}>
                            <span>{teamAnalysis.teamAName}</span>
                            <strong>{entry.teamARole}</strong>
                            <p>{entry.teamARole === 'Crew' ? `CPD ${formatMetric(entry.cpd, 2)}V` : entry.teamARole === 'Captain' ? `CVR ${formatMetric(entry.cvr, 2)}Ω` : '—'}</p>
                          </div>
                          <div className={`team-round-role-card ${entry.teamBRole === 'Captain' ? 'is-captain' : entry.teamBRole === 'Crew' ? 'is-crew' : ''}`}>
                            <span>{teamAnalysis.teamBName}</span>
                            <strong>{entry.teamBRole}</strong>
                            <p>{entry.teamBRole === 'Crew' ? `CPD ${formatMetric(entry.cpd, 2)}V` : entry.teamBRole === 'Captain' ? `CVR ${formatMetric(entry.cvr, 2)}Ω` : '—'}</p>
                          </div>
                        </div>
                        <p>CCI {formatMetric(entry.cci, 4)}A · Semantics {formatMetric(entry.meaning, 2)}% · MSE {formatMetric(entry.mse, 2)} · Card {entry.card}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {cciMenuOpen && canEditLearners && (
                <div className="cci-card-popover" role="menu" aria-label="CCI card selector">
                  {round.availableCciCards.map((card) => {
                    const selected = round.selectedCciCardId === card.id;
                    return (
                      <button
                        key={card.id}
                        type="button"
                        className={`cci-card-mini ${selected ? 'is-selected' : ''}`}
                        onClick={() => {
                          round.selectCciCard(card.id);
                          setCciMenuOpen(false);
                        }}
                        role="menuitemradio"
                        aria-checked={selected}
                        title={`${card.label} · ${card.baseA}A`}
                      >
                        <span className="cci-card-option-icon" aria-hidden="true"><CciCardGlyph icon={card.icon} /></span>
                        <span className="cci-card-option-copy">
                          <strong>{card.label}</strong>
                          <small>{card.baseA}A</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
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
          helperText={round.state === 'crew-waiting' ? 'Reply in English — faster response gets higher RT' : round.crewStreamingStatus}
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
