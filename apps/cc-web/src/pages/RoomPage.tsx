import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getBlob, ref as storageRef } from 'firebase/storage';
import { BarChart3 } from 'lucide-react';
import { RequirePlayer, usePlayerAuth } from '@/auth/PlayerAuth';
import { useMicrophoneGate } from '@/hooks/useMicrophoneGate';
import { RolePanel } from '@/components/RolePanel';
import { ResultCard } from '@/components/ResultCard';
import { SummaryVoiceCard } from '@/components/SummaryVoiceCard';
import { SummaryOhmCard } from '@/components/SummaryOhmCard';
import { db, storage } from '@/lib/firebase';
import { useRoom } from '@/rooms/useRoom';
import { useRoomGame } from '@/rooms/useRoomGame';

export default function RoomPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { user } = usePlayerAuth();

  if (!roomId) return <Navigate to="/" replace />;

  return (
    <RequirePlayer>
      <RoomInner roomId={roomId} userId={user?.uid || ''} onLeave={() => navigate('/')} />
    </RequirePlayer>
  );
}

function RoomInner({ roomId, userId, onLeave }: { roomId: string; userId: string; onLeave: () => void }) {
  const { room, rounds, loading } = useRoom(roomId, userId);
  const game = useRoomGame({ roomId, room, rounds });
  const mic = useMicrophoneGate();

  const currentRound = game.currentRound;
  const evaluation = currentRound?.meaningAnalysis || null;

  const [captainAudioUrl, setCaptainAudioUrl] = useState<string | null>(null);
  const [crewAudioUrl, setCrewAudioUrl] = useState<string | null>(null);
  const [showTeamSummary, setShowTeamSummary] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let localUrl: string | null = null;

    const blob = game.captainRecorder.audioBlob;
    if (blob) {
      localUrl = URL.createObjectURL(blob);
      setCaptainAudioUrl(localUrl);
      return () => {
        if (localUrl) URL.revokeObjectURL(localUrl);
      };
    }

    const audioPath = String((currentRound as any)?.captainAudioPath || '').trim();
    if (!storage || !audioPath) {
      setCaptainAudioUrl(null);
      return undefined;
    }

    void (async () => {
      try {
        const b = await getBlob(storageRef(storage, audioPath));
        if (cancelled) return;
        const url = URL.createObjectURL(b);
        localUrl = url;
        setCaptainAudioUrl(url);
      } catch {
        if (!cancelled) setCaptainAudioUrl(null);
      }
    })();

    return () => {
      cancelled = true;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [game.captainRecorder.audioBlob, currentRound]);

  useEffect(() => {
    let cancelled = false;
    let localUrl: string | null = null;

    const blob = game.crewRecorder.audioBlob;
    if (blob) {
      localUrl = URL.createObjectURL(blob);
      setCrewAudioUrl(localUrl);
      return () => {
        if (localUrl) URL.revokeObjectURL(localUrl);
      };
    }

    const audioPath = String((currentRound as any)?.crewAudioPath || '').trim();
    if (!storage || !audioPath) {
      setCrewAudioUrl(null);
      return undefined;
    }

    void (async () => {
      try {
        const b = await getBlob(storageRef(storage, audioPath));
        if (cancelled) return;
        const url = URL.createObjectURL(b);
        localUrl = url;
        setCrewAudioUrl(url);
      } catch {
        if (!cancelled) setCrewAudioUrl(null);
      }
    })();

    return () => {
      cancelled = true;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [game.crewRecorder.audioBlob, currentRound]);

  const teamSummary = useMemo(() => {
    const finished = rounds.filter((round) => round.status === 'finished');
    const captainWins = finished.filter((round) => round.winnerRole === 'captain');
    const crewWins = finished.filter((round) => round.winnerRole === 'crew');
    const sumCpd = (items: typeof finished) => items.reduce((sum, round) => sum + Math.max(0, Number((round as any)?.metrics?.cpd?.raw || 0)), 0);
    const sumCvr = (items: typeof finished) => items.reduce((sum, round) => sum + Math.max(0, Number((round as any)?.metrics?.cvr?.rawUnits || 0)), 0);

    return {
      totalRounds: finished.length,
      captain: {
        label: room?.teamMode ? 'Team A / Captain side' : 'Captain side',
        name: room?.teamMode ? (room.teamANames?.join(', ') || room.captainName || 'Team A') : (room?.captainName || 'Captain'),
        points: Number(room?.captainScore || 0),
        roundWins: captainWins.length,
        cpdWon: sumCpd(captainWins),
        cvrWon: sumCvr(captainWins),
        autoWins: finished.filter((round) => round.winnerRole === 'captain' && round.endReason === 'crew_timeout').length,
      },
      crew: {
        label: room?.teamMode ? 'Team B / Crew side' : 'Crew side',
        name: room?.teamMode ? (room.teamBNames?.join(', ') || room.crewName || 'Team B') : (room?.crewName || 'Crew'),
        points: Number(room?.crewScore || 0),
        roundWins: crewWins.length,
        cpdWon: sumCpd(finished), // total CPD "gotten" by the crew role across *all* rounds (per "ứng với role crew sẽ có CPD")
        autoWins: finished.filter((round) => round.winnerRole === 'crew' && (round.endReason === 'cvr_out_of_range' || round.endReason === 'perfect_crew')).length,
      },
      auto: {
        crewTimeout: finished.filter((round) => round.endReason === 'crew_timeout').length,
        cvrOutOfRange: finished.filter((round) => round.endReason === 'cvr_out_of_range').length,
        perfectCrew: finished.filter((round) => round.endReason === 'perfect_crew').length,
      },
    };
  }, [room, rounds]);

  const finishedRounds = useMemo(() => rounds.filter((r: any) => r.status === 'finished'), [rounds]);

  const canJoinAsCaptain = useMemo(() => !!room && !room.captainId && room.crewId !== userId, [room, userId]);
  const canJoinAsCrew = useMemo(() => !!room && !room.crewId && room.captainId !== userId, [room, userId]);

  const copyInvite = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/room/${roomId}`);
  };

  const copyCode = async () => {
    if (!room) return;
    const code = String(room.joinCode || roomId.slice(0, 6)).toUpperCase();
    await navigator.clipboard.writeText(code);
  };

  const startNewRound = async () => {
    await game.startRound();
  };

  const finishRoom = async () => {
    if (!db || !room) return;
    await updateDoc(doc(db, 'rooms', roomId), { status: 'finished', updatedAt: serverTimestamp() });
  };

  const showRolePick = !room?.captainId || !room?.crewId;
  const isCaptain = !!room && room.captainId === userId;
  const isCrew = !!room && room.crewId === userId;
  const isHost = !!room && room.hostId === userId;
  const isActiveRound = !!currentRound && currentRound.status !== 'finished';
  const myName = isCaptain ? room?.captainName : isCrew ? room?.crewName : null;

  const [nickname, setNickname] = useState<string>('');

  useEffect(() => {
    setNickname(String(myName || '').trim());
  }, [myName]);

  const saveNickname = async () => {
    if (!db || !room) return;
    const name = nickname.trim().slice(0, 40);
    if (!name) return;
    await updateDoc(doc(db, 'rooms', roomId), {
      ...(isCaptain ? { captainName: name } : isCrew ? { crewName: name } : {}),
      updatedAt: serverTimestamp(),
    });
  };

  if (loading) {
    return (
      <main className="screen-shell">
        <section className="soft-card admin-section-minimal">
          <p className="muted-copy">Loading room…</p>
        </section>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="screen-shell">
        <section className="soft-card admin-section-minimal">
          <p className="game-error">Room not found.</p>
          <div className="action-row">
            <button type="button" className="ghost-pill-button" onClick={onLeave}>Back</button>
          </div>
        </section>
      </main>
    );
  }


  return (
    <main className="game-screen">
      <div className="game-header brand-header room-page-header">
        <div className="chunks-brand-block">
          <img src="/chunks-logo.png" alt="Chunks" className="chunks-logo room-logo-tight" />
          <div>
            <p className="game-kicker">Room</p>
            <h1 className="game-title">{String(room.joinCode || roomId.slice(0, 6)).toUpperCase()}</h1>

          </div>
        </div>
        <div className="action-row room-header-actions">
          <button type="button" className="ghost-pill-button" onClick={() => void copyInvite()}>Copy invite</button>
          <button type="button" className="ghost-pill-button" onClick={() => void copyCode()}>Copy code</button>
          <button type="button" className="ghost-pill-button" onClick={onLeave}>Leave</button>
        </div>
      </div>

      {(room.captainId || room.crewId) && (
        <section className="soft-card admin-section-minimal" style={{ padding: 16 }}>
          <div className="action-row" style={{ justifyContent: 'space-between' }}>
            <div>
              <span className="soft-label" style={{ color: 'var(--red)' }}>Captain</span>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--red)' }}>{(room.captainName || '—')}</div>
            </div>
            <div className="room-score-center">
              <div style={{ fontSize: 20, fontWeight: 800 }}>{Number(room.captainScore || 0)} : {Number(room.crewScore || 0)}</div>
              <button
                type="button"
                className="ghost-pill-button icon-only-button team-score-trigger"
                onClick={() => setShowTeamSummary((value) => !value)}
                aria-expanded={showTeamSummary}
                aria-label="Open team score popover"
              >
                <BarChart3 size={16} aria-hidden="true" />
              </button>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className="soft-label" style={{ color: 'var(--blue)' }}>Crew</span>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--blue)' }}>{(room.crewName || '—')}</div>
            </div>
          </div>

          {/* Backdrop for easy dismiss (especially on phone) */}
          {showTeamSummary && (
            <div
              className="team-score-backdrop"
              onClick={() => setShowTeamSummary(false)}
              aria-hidden="true"
            />
          )}

          {/* team-score-popover: icon-only trigger above; mobile-first bottom sheet / popover with role focus, per-round detail rows (clear red captain / blue crew), correct mini-crew CPD, CVR+CPD team cards, and rule analysis from image.png */}
          {showTeamSummary && (
            <div
              className="team-score-popover"
              role="dialog"
              aria-label="Team score details and analysis"
              aria-live="polite"
            >
              <div className="team-score-popover-header">
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Team Scores • CVR &amp; CPD</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {isCrew ? 'Crew role: focus on CPD (blue)' : isCaptain ? 'Captain role: focus on CVR (red)' : 'Team aggregate'}
                  </div>
                </div>
                <button
                  type="button"
                  className="ghost-pill-button"
                  style={{ minHeight: 32, padding: '0 10px', fontSize: 16, lineHeight: 1 }}
                  onClick={() => setShowTeamSummary(false)}
                  aria-label="Close team scores"
                >
                  ×
                </button>
              </div>

              {/* Team cards: CVR & CPD sums per side.
                  Captain side: CVR sum (what captain role "sets") + Won CPD (from rounds it won as captain).
                  Crew side: CPD sum = total CPD across *all* rounds (the value the crew role "gets" every round, per "ứng với role crew sẽ có CPD").
                  Scientific winner = side with higher relevant sum CPD (comparison below). */}
              <div className="team-score-grid">
                <div className="team-score-card team-score-card-captain">
                  <span className="soft-label" style={{ color: 'var(--red)' }}>{teamSummary.captain.label}</span>
                  <h3>{teamSummary.captain.name}</h3>
                  <strong>{teamSummary.captain.points} pts</strong>
                  <div className="team-score-metrics">
                    <div>CVR sum: <span className="metric-cvr">{teamSummary.captain.cvrWon.toFixed(1)} Ω</span></div>
                    <div>Won CPD: <span className="metric-cpd">{teamSummary.captain.cpdWon.toFixed(2)} V</span></div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>Round wins: {teamSummary.captain.roundWins}</div>
                </div>
                <div className="team-score-card team-score-card-crew">
                  <span className="soft-label" style={{ color: 'var(--blue)' }}>{teamSummary.crew.label}</span>
                  <h3>{teamSummary.crew.name}</h3>
                  <strong>{teamSummary.crew.points} pts</strong>
                  <div className="team-score-metrics">
                    <div>CPD sum (crew gets): <span className="metric-cpd">{teamSummary.crew.cpdWon.toFixed(2)} V</span></div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>Round wins: {teamSummary.crew.roundWins}</div>
                </div>
              </div>

              {/* Higher sum CPD of the 2 sides/teams decides scientific winner (per rule).
                  Note: crew side CPD sum is the *total* across all rounds (crew role "gets" CPD every round).
                  Captain side "Won CPD" is only from rounds it won as captain. */}
              <div className="team-score-comparison">
                {teamSummary.crew.cpdWon > teamSummary.captain.cpdWon && 'Crew side leads on total CPD sum'}
                {teamSummary.captain.cpdWon > teamSummary.crew.cpdWon && 'Captain side leads on its Won CPD'}
                {teamSummary.captain.cpdWon === teamSummary.crew.cpdWon && teamSummary.totalRounds > 0 && 'CPD sums equal'}
                {teamSummary.totalRounds === 0 && 'Play rounds to see CPD sums'}
              </div>

              {/* Per-round detail rows: makes captain (red) / crew (blue) association clear per round.
                  team-score-mini-crew always renders the round's own CPD (the value "crew gets" this round, regardless of who won the round).
                  The crew card above uses the *total* of these for the crew side. */}
              {finishedRounds.length > 0 && (
                <div className="team-rounds-section">
                  <div className="team-rounds-title">Per-round breakdown</div>
                  <div className="team-rounds-list">
                    {finishedRounds.map((round: any, idx: number) => {
                      const cvr = Number(round?.metrics?.cvr?.rawUnits || 0);
                      const cpd = Number(round?.metrics?.cpd?.raw || 0);
                      const wr = round?.winnerRole as 'captain' | 'crew' | undefined;
                      const isCaptainWin = wr === 'captain';
                      return (
                        <div
                          key={round.id || idx}
                          className={`team-round-detail-row ${isCaptainWin ? 'is-captain-win' : wr === 'crew' ? 'is-crew-win' : ''}`}
                        >
                          <span className="team-round-num">R{round.roundNumber || (idx + 1)}</span>
                          <span className="team-score-mini team-score-mini-captain" title="Captain CVR (red)">CVR {cvr.toFixed(1)}</span>
                          <span className="team-score-mini team-score-mini-crew" title="CPD (blue) — crew gets this value">CPD {cpd.toFixed(2)}</span>
                          <span className={`team-round-winner ${isCaptainWin ? 'win-captain' : wr === 'crew' ? 'win-crew' : ''}`}>
                            {isCaptainWin ? 'Captain' : wr === 'crew' ? 'Crew' : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* team-score-card-analysis: mirrors the attached image.png rule exactly (CREW blue left, CAPTAIN red right, formulas, auto rules, higher sum CPD winner) */}
              <div className="team-score-card-analysis">
                <div className="rule-headers">
                  <div className="rule-col rule-crew">
                    <span style={{ color: 'var(--blue)', fontWeight: 700 }}>CREW</span>
                    <span style={{ fontSize: 10 }}>(Thrower &amp; catcher)</span>
                  </div>
                  <div className="rule-col rule-captain">
                    <span style={{ color: 'var(--red)', fontWeight: 700 }}>CAPTAIN</span>
                    <span style={{ fontSize: 10 }}>(Hitter)</span>
                  </div>
                </div>

                <div className="rule-formula" style={{ fontSize: 12, justifyContent: 'center' }}>
                  <span className="metric-cvr">Initial CVR</span>
                  <span className="rule-op">×</span>
                  <span className="metric-cci">real CCI</span>
                  <span className="rule-op">=</span>
                  <span className="metric-cpd">CPD (V)</span>
                </div>

                <div className="rule-note" style={{ fontSize: 11, fontWeight: 600, color: 'var(--blue)' }}>
                  Higher sum CPD of the two teams → winner
                </div>

                <div className="rule-note" style={{ fontSize: 11 }}>
                  Auto: CVR out of [1 : 50] Ω → crew wins round (collective effect).<br />
                  Crew timeout → captain wins round.
                </div>

                <div className="rule-note" style={{ fontSize: 10, color: 'var(--muted)' }}>
                  Real CCI = (%semantics + %MSE) × fixed CCI (Ampe)
                </div>
              </div>

              <div className="team-score-footer">
                <span>Finished: {teamSummary.totalRounds}. Crew side CPD sum = total from all rounds (crew role gets CPD every round). Captain "Won CPD" only from rounds it won as captain. Match points (pts) still official scoreboard.</span>
              </div>
            </div>
          )}
          {isHost && (room.captainId || room.crewId) && (
            <div className="action-row" style={{ marginTop: 12 }}>
              {isActiveRound && (
                <button type="button" className="ghost-pill-button" onClick={() => void game.finishCurrentRound()}>
                  End current round
                </button>
              )}
              {room.captainId && (
                <button type="button" className="ghost-pill-button" onClick={() => void game.finishCurrentRound({ clearRole: 'captain' })}>
                  {isActiveRound ? 'End & open Captain' : 'Open Captain slot'}
                </button>
              )}
              {room.crewId && (
                <button type="button" className="ghost-pill-button" onClick={() => void game.finishCurrentRound({ clearRole: 'crew' })}>
                  {isActiveRound ? 'End & open Crew' : 'Open Crew slot'}
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {showRolePick ? (
        <section className="soft-card admin-section-minimal">
          <p className="muted-copy">Choose your role</p>
          <div className="action-row" style={{ marginTop: 12 }}>
            <button type="button" className="primary-pill-button" disabled={!canJoinAsCaptain} onClick={() => void game.joinRole('captain')}>Captain</button>
            <button type="button" className="primary-pill-button" disabled={!canJoinAsCrew} onClick={() => void game.joinRole('crew')}>Crew</button>
          </div>
          <p className="muted-copy" style={{ marginTop: 12 }}>Waiting for both players…</p>
        </section>
      ) : (isCaptain || isCrew) && !String(myName || '').trim() ? (
        <section className="soft-card admin-section-minimal">
          <p className="muted-copy">Your nickname</p>
          <p className="admin-message">Set a short name so your partner can recognize you.</p>
          <div className="field-stack">
            <label>Nickname</label>
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="e.g., Genshai" maxLength={40} />
          </div>
          <div className="action-row">
            <button type="button" className="primary-pill-button" onClick={() => void saveNickname()} disabled={!nickname.trim()}>
              Save nickname
            </button>
            <button type="button" className="ghost-pill-button" onClick={onLeave}>Leave</button>
          </div>
        </section>
      ) : !isCaptain && !isCrew ? (
        <section className="soft-card admin-section-minimal">
          <p className="muted-copy">Room is full</p>
          <p className="admin-message">Ask the host to end the current round and open a Captain or Crew slot. When a slot opens, you can choose your role here.</p>
          <div className="action-row">
            <button type="button" className="ghost-pill-button" onClick={onLeave}>Leave</button>
            <button type="button" className="ghost-pill-button" onClick={() => void copyInvite()}>Copy invite</button>
          </div>
        </section>
      ) : !mic.micReady ? (
        <section className="soft-card admin-section-minimal">
          <p className="muted-copy">Microphone permission</p>
          <p className="admin-message">Please enable microphone access before starting the game.</p>
          {mic.micError && <p className="game-error">{mic.micError}</p>}
          <div className="action-row">
            <button type="button" className="primary-pill-button" onClick={() => void mic.requestMic()} disabled={mic.requesting}>
              {mic.requesting ? 'Requesting…' : 'Enable microphone'}
            </button>
            <button type="button" className="ghost-pill-button" onClick={onLeave}>Leave</button>
          </div>
        </section>
      ) : (
        <>
          {!currentRound || currentRound.status === 'finished' ? (
            <section className="soft-card admin-section-minimal">
              {currentRound?.status === 'finished' && (
                <section className="summary-two-up" style={{ marginTop: 12 }}>
                  <SummaryVoiceCard
                    title="Vietnamese input"
                    subtitle={`Captain${room.captainName ? ` · ${room.captainName}` : ''}`}
                    transcript={currentRound?.captainTranscript || null}
                    transcriptMeta={currentRound?.captainTranscriptMeta || null}
                    audioUrl={captainAudioUrl}
                    audioFallbackMessage="Audio replay is available on the recording device. (To share across devices, enable Firebase Storage.)"
                  />
                  <SummaryVoiceCard
                    title="English response"
                    subtitle={`Crew${room.crewName ? ` · ${room.crewName}` : ''}`}
                    transcript={currentRound?.crewTranscript || null}
                    transcriptMeta={currentRound?.crewTranscriptMeta || null}
                    audioUrl={crewAudioUrl}
                    audioFallbackMessage="Audio replay is available on the recording device. (To share across devices, enable Firebase Storage.)"
                  />
                </section>
              )}

              {currentRound?.status === 'finished' && (
                <SummaryOhmCard
                  ohmResult={(currentRound as any)?.ohmResult || null}
                  reactionDelayMs={currentRound?.reactionDelayMs || null}
                  metrics={(currentRound as any)?.metrics || null}
                />
              )}

              {evaluation && (
                <ResultCard evaluation={evaluation} reactionDelayMs={currentRound?.reactionDelayMs || null} onReset={() => void startNewRound()} />
              )}

              {!evaluation && currentRound?.status === 'finished' && currentRound?.endReason === 'crew_timeout' && (
                <p className="game-error" style={{ marginTop: 0 }}>
                  Crew did not start in time. {game.isCaptain ? 'Captain wins.' : 'Game over.'}
                </p>
              )}
              <div className="action-row" style={{ marginTop: 12 }}>
                {game.isCaptain ? (
                  <button type="button" className="primary-pill-button" onClick={() => void startNewRound()} disabled={!game.canStartRound}>
                    Start new round
                  </button>
                ) : (
                  <p className="muted-copy">Waiting for Captain to start…</p>
                )}
                {room.hostId === userId && (
                  <button type="button" className="ghost-pill-button" onClick={() => void game.swapRoles()} disabled={!room.captainId || !room.crewId}>
                    Swap roles
                  </button>
                )}
                <button type="button" className="ghost-pill-button" onClick={() => void finishRoom()}>Finish room</button>
              </div>
            </section>
          ) : (
            <section className="playfield-shell">
              <RolePanel
                role="captain"
                title="Captain"
                color="red"
                recording={game.captainRecorder.isRecording}
                active={currentRound.status === 'captain_speaking'}
                disabled={!game.canStartCaptain}
                processing={game.processing && game.isCaptain}
                countdownLabel={currentRound.status === 'crew_speaking' ? game.crewCountdownLabel : undefined}
                helperText={currentRound.status === 'captain_speaking' ? 'Speak Vietnamese' : 'Wait'}
                levels={game.captainRecorder.levels}
                onStart={() => void game.startCaptain()}
                onStop={() => void game.stopCaptain()}
              />

              <RolePanel
                role="crew"
                title="Crew"
                color="blue"
                recording={game.crewRecorder.isRecording}
                active={currentRound.status === 'crew_speaking' || currentRound.status === 'evaluating'}
                disabled={!game.canStartCrew}
                processing={game.processing && game.isCrew}
                countdownLabel={game.crewCountdownLabel}
                helperText={currentRound.status === 'crew_speaking' ? 'Reply in English' : 'Wait'}
                levels={game.crewRecorder.levels}
                onStart={() => void game.startCrew()}
                onStop={() => void game.stopCrew()}
              />
            </section>
          )}
        </>
      )}

      {currentRound?.status === 'evaluating' && (
        <div className="analysis-overlay" role="status" aria-live="polite">
          <div className="spiral-loader" aria-hidden="true">
            <span className="spiral-ring spiral-ring-blue" />
            <span className="spiral-ring spiral-ring-red" />
            <span className="spiral-core" />
          </div>
          <p className="analysis-overlay-title">analyzing meaning</p>
          <p className="analysis-overlay-subtitle">transcribing and comparing meaning</p>
        </div>
      )}
    </main>
  );
}
