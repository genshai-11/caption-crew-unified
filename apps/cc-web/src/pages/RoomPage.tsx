import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getBlob, ref as storageRef } from 'firebase/storage';
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
            <div style={{ fontSize: 20, fontWeight: 800 }}>{Number(room.captainScore || 0)} : {Number(room.crewScore || 0)}</div>
            <div style={{ textAlign: 'right' }}>
              <span className="soft-label" style={{ color: 'var(--blue)' }}>Crew</span>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--blue)' }}>{(room.crewName || '—')}</div>
            </div>
          </div>
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
                    title="Component 1"
                    subtitle="Captain · Vietnamese input"
                    transcript={currentRound?.captainTranscript || null}
                    transcriptMeta={currentRound?.captainTranscriptMeta || null}
                    audioUrl={captainAudioUrl}
                    audioFallbackMessage="Audio replay is available on the recording device. (To share across devices, enable Firebase Storage.)"
                  />
                  <SummaryVoiceCard
                    title="Component 2"
                    subtitle="Crew · English response"
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
