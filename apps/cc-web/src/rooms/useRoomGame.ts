import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from '@/lib/firebase';
import { loadAdminRuntimeConfig } from '@/services/adminConfigRepository';
import { evaluateCaptionCrewMeaning } from '@/services/meaningService';
import { transcribeRoundAudio } from '@/services/transcriptionService';
import { analyzeTranscript } from '@/services/aiService';
import { saveRound } from '@/services/roundRepository';
import { useRoundRecorder } from '@/hooks/useRoundRecorder';
import { createRoomWithJoinCode } from './roomService';
import { usePublicTiming } from '@/hooks/usePublicTiming';
import { usePublicScoring } from '@/hooks/usePublicScoring';
import { buildRoundMetrics, type OhmResult } from '@/types';
import type { RoomDoc, RoomRoundDoc } from './types';

function extensionForMime(mime: string) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('audio/mp4')) return 'mp4';
  if (m.includes('audio/ogg')) return 'ogg';
  if (m.includes('audio/webm')) return 'webm';
  return 'webm';
}

function toOhmScore(voltage: number) {
  if (voltage <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((voltage / 120) * 100)));
}

function getDifficultyLabel(voltage: number) {
  if (voltage >= 45) return 'Advanced';
  if (voltage >= 25) return 'Intermediate';
  return 'Beginner';
}

async function uploadRoundAudio(params: {
  roomId: string;
  roundId: string;
  role: 'captain' | 'crew';
  blob: Blob;
}) {
  const { roomId, roundId, role, blob } = params;
  if (!storage) throw new Error('Storage not configured');
  if (!db) throw new Error('Firestore not configured');

  const mimeType = blob.type || 'audio/webm';
  const ext = extensionForMime(mimeType);
  const path = `rooms/${roomId}/rounds/${roundId}/${role}.${ext}`;
  const ref = storageRef(storage, path);

  await uploadBytes(ref, blob, { contentType: mimeType });

  const roundRef = doc(db, 'rooms', roomId, 'rounds', roundId);
  await updateDoc(roundRef, {
    ...(role === 'captain' ? { captainAudioPath: path, captainAudioMimeType: mimeType } : { crewAudioPath: path, crewAudioMimeType: mimeType }),
  });

  return { path, mimeType };
}

async function waitForCaptainTranscript(params: {
  roomId: string;
  roundId: string;
  timeoutMs?: number;
  intervalMs?: number;
}) {
  const { roomId, roundId, timeoutMs = 25000, intervalMs = 600 } = params;
  if (!db) throw new Error('Firestore not configured');

  const started = Date.now();
  const roundRef = doc(db, 'rooms', roomId, 'rounds', roundId);

  while (Date.now() - started < timeoutMs) {
    const snap = await getDoc(roundRef);
    const data = snap.data() as RoomRoundDoc | undefined;
    const captainTranscript = String(data?.captainTranscript || '').trim();
    if (captainTranscript) return captainTranscript;
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return '';
}

type RoundWinnerRole = 'captain' | 'crew';

function buildRoomWinUpdates(params: {
  roomData: any;
  winnerRole: RoundWinnerRole;
  targetPoints: number;
  swapAfterRoundSetting: boolean;
}) {
  const { roomData, winnerRole, targetPoints, swapAfterRoundSetting } = params;
  const captainScore = Number(roomData?.captainScore || 0);
  const crewScore = Number(roomData?.crewScore || 0);
  const nextCaptain = winnerRole === 'captain' ? captainScore + 1 : captainScore;
  const nextCrew = winnerRole === 'crew' ? crewScore + 1 : crewScore;
  const matchOver = nextCaptain >= targetPoints || nextCrew >= targetPoints;
  const nextStatus = matchOver ? 'finished' : roomData.status;

  const updates: Record<string, unknown> = {
    captainScore: nextCaptain,
    crewScore: nextCrew,
    status: nextStatus,
    updatedAt: serverTimestamp(),
  };

  // Team rotation (only when not yet finished)
  if (!matchOver && roomData.teamMode) {
    const teamA: string[] = Array.isArray(roomData.teamA) ? roomData.teamA : [];
    const teamB: string[] = Array.isArray(roomData.teamB) ? roomData.teamB : [];
    const teamANames: string[] = Array.isArray(roomData.teamANames) ? roomData.teamANames : [];
    const teamBNames: string[] = Array.isArray(roomData.teamBNames) ? roomData.teamBNames : [];

    const shouldSwap = roomData.swapAfterRound ?? swapAfterRoundSetting;

    if (shouldSwap) {
      // Full swap: Team A ↔ Team B
      const newAIndex = typeof roomData.teamBIndex === 'number' ? roomData.teamBIndex : 0;
      const newBIndex = typeof roomData.teamAIndex === 'number' ? roomData.teamAIndex : 0;
      updates.teamA = teamB;
      updates.teamB = teamA;
      updates.teamANames = teamBNames;
      updates.teamBNames = teamANames;
      updates.teamAIndex = newAIndex;
      updates.teamBIndex = newBIndex;
      updates.captainId = teamB[newAIndex] || roomData.captainId;
      updates.captainName = teamBNames[newAIndex] || roomData.captainName;
      updates.crewId = teamA[newBIndex] || roomData.crewId;
      updates.crewName = teamANames[newBIndex] || roomData.crewName;
    } else {
      // Rotate active player within each team
      const nextAIndex = teamA.length > 1
        ? (Number(roomData.teamAIndex || 0) + 1) % teamA.length
        : Number(roomData.teamAIndex || 0);
      const nextBIndex = teamB.length > 1
        ? (Number(roomData.teamBIndex || 0) + 1) % teamB.length
        : Number(roomData.teamBIndex || 0);
      updates.teamAIndex = nextAIndex;
      updates.teamBIndex = nextBIndex;
      if (teamA[nextAIndex]) {
        updates.captainId = teamA[nextAIndex];
        updates.captainName = teamANames[nextAIndex] || null;
      }
      if (teamB[nextBIndex]) {
        updates.crewId = teamB[nextBIndex];
        updates.crewName = teamBNames[nextBIndex] || null;
      }
    }
  }

  return updates;
}

export function useRoomGame(params: {
  roomId: string;
  room: (RoomDoc & { id: string }) | null;
  rounds: Array<RoomRoundDoc & { id: string }>;
}) {
  const { roomId, room, rounds } = params;
  const user = auth?.currentUser || null;

  const timing = usePublicTiming();
  const crewResponseTimeoutMs = timing.crewResponseTimeoutMs;

  const scoring = usePublicScoring();
  const crewWinThreshold = scoring.crewWinThreshold;
  const targetPoints = scoring.targetPoints;
  const mseCoefficient = scoring.mseCoefficient;
  const cvrTargetRawUnits = scoring.cvrTargetRawUnits;
  const cvrMinVolt = scoring.cvrMinVolt;
  const cvrMaxVolt = scoring.cvrMaxVolt;
  const enablePerfectCrewBonus = scoring.enablePerfectCrewBonus;
  const swapAfterRoundSetting = scoring.swapAfterRound;

  const captainRecorder = useRoundRecorder();
  const crewRecorder = useRoundRecorder();

  const [processing, setProcessing] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const currentRound = rounds.length ? rounds[rounds.length - 1] : null;
  const isCaptain = !!user?.uid && room?.captainId === user.uid;
  const isCrew = !!user?.uid && room?.crewId === user.uid;

  const canStartRound = Boolean(user?.uid && isCaptain);
  const canStartCaptain = Boolean(currentRound && currentRound.status === 'captain_speaking' && isCaptain && !processing);
  const canStartCrew = Boolean(currentRound && currentRound.status === 'crew_speaking' && isCrew && !processing);

  const crewDeadlineAtMs = useMemo(() => {
    if (!currentRound) return null;
    if (typeof currentRound.crewDeadlineAtMs === 'number') return currentRound.crewDeadlineAtMs;
    if (typeof currentRound.captainStoppedAtMs === 'number') return currentRound.captainStoppedAtMs + crewResponseTimeoutMs;
    return null;
  }, [currentRound, crewResponseTimeoutMs]);

  const crewRemainingMs = useMemo(() => {
    if (!crewDeadlineAtMs) return null;
    if (currentRound?.crewStartedAtMs) return 0;
    return Math.max(0, crewDeadlineAtMs - nowMs);
  }, [crewDeadlineAtMs, currentRound?.crewStartedAtMs, nowMs]);

  const crewCountdownLabel = useMemo(() => {
    if (!crewDeadlineAtMs) return undefined;
    if (currentRound?.status !== 'crew_speaking') return undefined;
    if (currentRound?.crewStartedAtMs) return undefined;
    const s = Math.ceil((crewRemainingMs ?? 0) / 1000);
    return `Remaining: ${String(s).padStart(2, '0')}s`;
  }, [crewDeadlineAtMs, crewRemainingMs, currentRound?.status, currentRound?.crewStartedAtMs]);

  useEffect(() => {
    if (!crewDeadlineAtMs) return;
    if (!currentRound || currentRound.status !== 'crew_speaking') return;
    if (currentRound.crewStartedAtMs) return;

    const t = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [crewDeadlineAtMs, currentRound?.status, currentRound?.crewStartedAtMs]);

  useEffect(() => {
    if (!db) return;
    if (!isCaptain) return;
    if (!currentRound || currentRound.status !== 'crew_speaking') return;
    if (!crewDeadlineAtMs) return;
    if (currentRound.crewStartedAtMs) return;
    if ((crewRemainingMs ?? 1) > 0) return;

    const roundRef = doc(db, 'rooms', roomId, 'rounds', currentRound.id);
    const roomRef = doc(db, 'rooms', roomId);
    void runTransaction(db, async (tx) => {
      const roundSnap = await tx.get(roundRef);
      if (!roundSnap.exists()) return;
      const data = roundSnap.data() as any;
      if (data.status !== 'crew_speaking') return;
      if (data.crewStartedAtMs) return;

      const roomSnap = await tx.get(roomRef);
      if (!roomSnap.exists()) return;
      const roomData = roomSnap.data() as any;
      const winnerRole: RoundWinnerRole = 'captain';

      tx.update(roundRef, {
        status: 'finished',
        winnerRole,
        endReason: 'crew_timeout',
        crewDeadlineAtMs: crewDeadlineAtMs,
      });
      tx.update(roomRef, buildRoomWinUpdates({
        roomData,
        winnerRole,
        targetPoints,
        swapAfterRoundSetting,
      }));
    });
  }, [crewDeadlineAtMs, crewRemainingMs, currentRound?.crewStartedAtMs, currentRound?.id, currentRound?.status, isCaptain, roomId, swapAfterRoundSetting, targetPoints]);

  const joinRole = useCallback(
    async (role: 'captain' | 'crew') => {
      if (!db) throw new Error('Firestore not configured');
      if (!user?.uid) throw new Error('Please sign in first');

      const roomRef = doc(db, 'rooms', roomId);
      await updateDoc(roomRef, {
        ...(role === 'captain' ? { captainId: user.uid } : { crewId: user.uid }),
        updatedAt: serverTimestamp(),
      });

      // Save per-user room mapping for Lobby listing
      await setDoc(doc(db, 'users', user.uid, 'rooms', roomId), {
        roomId,
        role,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      }, { merge: true });
    },
    [roomId, user?.uid]
  );

  // Persist finished rounds into user history so History page isn't empty.
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    if (!currentRound || currentRound.status !== 'finished') return;

    const evaluation = (currentRound as any).meaningAnalysis || null;
    const endReason = (currentRound as any).endReason || null;
    const winnerRole = (currentRound as any).winnerRole || null;

    const fallbackEvaluation = endReason === 'crew_timeout'
      ? {
        matchScore: 0,
        decision: 'timeout',
        reason: 'Crew did not start in time.',
      }
      : null;

    const evalWithWinner = (evaluation || fallbackEvaluation) ? {
      ...(evaluation || fallbackEvaluation),
      reason: `${(evaluation || fallbackEvaluation)?.reason || ''}${winnerRole ? ` (winner: ${winnerRole})` : ''}`.trim(),
    } : null;

    void saveRound({
      id: `${roomId}-${currentRound.id}`,
      createdAt: new Date().toISOString(),
      state: 'results',
      captainTranscript: (currentRound as any).captainTranscriptMeta,
      crewTranscript: (currentRound as any).crewTranscriptMeta,
      evaluation: evalWithWinner,
      ohmResult: (currentRound as any).ohmResult || null,
      metrics: (currentRound as any).metrics || null,
      reactionDelayMs: (currentRound as any).reactionDelayMs ?? null,
      timeoutLost: endReason === 'crew_timeout' && isCrew,
      captainAudioPath: (currentRound as any).captainAudioPath,
      crewAudioPath: (currentRound as any).crewAudioPath,
      captainAudioMimeType: (currentRound as any).captainAudioMimeType,
      crewAudioMimeType: (currentRound as any).crewAudioMimeType,
    } as any);
  }, [currentRound?.id, currentRound?.status, isCrew, roomId, user?.uid]);

  const swapRoles = useCallback(async () => {
    if (!db) throw new Error('Firestore not configured');
    if (!room) throw new Error('Room not loaded');
    if (!user?.uid || user.uid !== room.hostId) throw new Error('Only the host can swap roles.');

    await updateDoc(doc(db, 'rooms', roomId), {
      captainId: room.crewId || null,
      crewId: room.captainId || null,
      captainName: room.crewName || null,
      crewName: room.captainName || null,
      updatedAt: serverTimestamp(),
    });
  }, [room, roomId, user?.uid]);

  const finishCurrentRound = useCallback(async (options?: { clearRole?: 'captain' | 'crew' }) => {
    if (!db) throw new Error('Firestore not configured');
    if (!room) throw new Error('Room not loaded');
    if (!user?.uid || user.uid !== room.hostId) throw new Error('Only the host can end or rotate the active players.');

    const updates: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (options?.clearRole === 'captain') {
      updates.captainId = null;
      updates.captainName = null;
    }
    if (options?.clearRole === 'crew') {
      updates.crewId = null;
      updates.crewName = null;
    }

    if (currentRound && currentRound.status !== 'finished') {
      await updateDoc(doc(db, 'rooms', roomId, 'rounds', currentRound.id), {
        status: 'finished',
        winnerRole: 'none',
        endReason: 'manual',
      });
    }

    if (options?.clearRole) {
      updates.status = 'waiting';
    } else if (currentRound && currentRound.status !== 'finished') {
      updates.status = 'playing';
    }

    await updateDoc(doc(db, 'rooms', roomId), updates);
  }, [currentRound, room, roomId, user?.uid]);

  const createRoom = useCallback(async () => {
    if (!user?.uid) throw new Error('Please sign in first');
    const { roomId } = await createRoomWithJoinCode(user.uid);
    return roomId;
  }, [user?.uid]);

  const startRound = useCallback(async () => {
    if (!db) throw new Error('Firestore not configured');
    if (!user?.uid || !isCaptain) return;

    const roundsRef = collection(db, 'rooms', roomId, 'rounds');
    await addDoc(roundsRef, {
      roomId,
      roundNumber: rounds.length + 1,
      status: 'captain_speaking',
      captainPlayerId: room?.captainId || null,
      crewPlayerId: room?.crewId || null,
      createdAt: serverTimestamp(),
    } satisfies Partial<RoomRoundDoc>);

    await updateDoc(doc(db, 'rooms', roomId), {
      status: 'playing',
      updatedAt: serverTimestamp(),
    });
  }, [isCaptain, room?.captainId, room?.crewId, roomId, rounds.length, user?.uid]);

  const startCaptain = useCallback(async () => {
    await captainRecorder.start();
  }, [captainRecorder]);

  const stopCaptain = useCallback(async () => {
    if (!db) return;
    if (!currentRound) return;

    setProcessing(true);
    const blob = await captainRecorder.stop();
    if (!blob) {
      setProcessing(false);
      return;
    }

    const roundRef = doc(db, 'rooms', roomId, 'rounds', currentRound.id);

    // IMPORTANT: move to crew immediately (do not wait transcript)
    const stoppedAtMs = Date.now();
    await updateDoc(roundRef, {
      status: 'crew_speaking',
      captainStoppedAtMs: stoppedAtMs,
      crewDeadlineAtMs: stoppedAtMs + crewResponseTimeoutMs,
    });

    // Background STT
    void (async () => {
      try {
        const result = await transcribeRoundAudio(blob, { role: 'captain', language: 'vi' });
        await updateDoc(roundRef, {
          captainTranscript: result.transcript,
          captainTranscriptMeta: result,
        });
      } catch {
        // ignore; crew can still proceed
      }
    })();

    // Background audio upload (for cross-device replay)
    void (async () => {
      try {
        await uploadRoundAudio({ roomId, roundId: currentRound.id, role: 'captain', blob });
      } catch {
        // ignore upload errors; transcript/results still work
      }
    })();

    setProcessing(false);
  }, [captainRecorder, currentRound, roomId]);

  const startCrew = useCallback(async () => {
    if (!db || !currentRound) return;
    const roundRef = doc(db, 'rooms', roomId, 'rounds', currentRound.id);
    await updateDoc(roundRef, {
      crewStartedAtMs: Date.now(),
    });
    await crewRecorder.start();
  }, [crewRecorder, currentRound, roomId]);

  const stopCrew = useCallback(async () => {
    if (!db) return;
    if (!currentRound) return;

    setProcessing(true);
    const blob = await crewRecorder.stop();
    if (!blob) {
      setProcessing(false);
      return;
    }

    const roundRef = doc(db, 'rooms', roomId, 'rounds', currentRound.id);

    // Set evaluating quickly
    await updateDoc(roundRef, {
      status: 'evaluating',
    });

    // Background audio upload (for cross-device replay)
    void (async () => {
      try {
        await uploadRoundAudio({ roomId, roundId: currentRound.id, role: 'crew', blob });
      } catch {
        // ignore upload errors; transcript/results still work
      }
    })();

    try {
      const crewResult = await transcribeRoundAudio(blob, { role: 'crew', language: 'en' });
      await updateDoc(roundRef, {
        crewTranscript: crewResult.transcript,
        crewTranscriptMeta: crewResult,
      });

      // Wait for captain transcript if not ready yet
      const snap = await getDoc(roundRef);
      const data = snap.data() as RoomRoundDoc | undefined;
      const captainTranscript =
        String(data?.captainTranscript || '').trim() ||
        (await waitForCaptainTranscript({ roomId, roundId: currentRound.id }));

      const evaluation = await evaluateCaptionCrewMeaning({
        captainTranscript,
        crewTranscript: crewResult.transcript,
        strictness: 'medium',
      });

      let ohmResult: OhmResult | null = null;
      let cvrSource = 'cvr-analysis';
      try {
        const runtimeConfig = loadAdminRuntimeConfig();

        const rawPrimaryModel = String(runtimeConfig.ohmModel || runtimeConfig.router9Model || '').trim();
        const rawFallbackModel = String(runtimeConfig.ohmFallbackModel || runtimeConfig.router9FallbackModel || '').trim();

        const normalizeModel = (value: string) => {
          const v = String(value || '').trim();
          if (!v) return '';
          if (v.toLowerCase().startsWith('google/')) return '';
          return v;
        };

        const safeModel = normalizeModel(rawPrimaryModel) || 'gpt';
        const safeFallbackModel = normalizeModel(rawFallbackModel) || safeModel;

        const aiAnalysis = await analyzeTranscript(captainTranscript, {
          model: safeModel,
          fallbackModel: safeFallbackModel,
          reactionDelayMs: Number(data?.reactionDelayMs || 0) || undefined,
          sessionId: `${roomId}-${currentRound.id}`,
        });

        cvrSource = String(aiAnalysis.analysisSource || 'cvr-analysis');
        const totalOhm = Number(aiAnalysis.totalOhm || 0);
        const current = Number(aiAnalysis.lengthCoefficient || 1);
        const voltage = totalOhm;

        ohmResult = {
          totalOhm,
          formula: String(aiAnalysis.formula || '0'),
          current,
          voltage,
          score: toOhmScore(voltage),
          difficulty: getDifficultyLabel(voltage),
          chunkCount: Array.isArray(aiAnalysis.chunks) ? aiAnalysis.chunks.length : 0,
          chunks: Array.isArray(aiAnalysis.chunks)
            ? aiAnalysis.chunks
                .map((chunk) => ({
                  text: String(chunk?.text || ''),
                  label: String(chunk?.label || '').toUpperCase(),
                  ohm: Number(chunk?.ohm || 0),
                }))
                .filter((chunk) => ['GREEN', 'BLUE', 'RED', 'PINK'].includes(chunk.label)) as OhmResult['chunks']
            : [],
        };
      } catch (error) {
        console.warn('OHM analysis failed for room flow', error);
      }

      const captainStoppedAtMs = Number(data?.captainStoppedAtMs || 0);
      const crewStartedAtMs = Number(data?.crewStartedAtMs || 0);
      const reactionDelayMs =
        captainStoppedAtMs && crewStartedAtMs ? Math.max(0, crewStartedAtMs - captainStoppedAtMs) : undefined;

      const cciCards = Math.max(1, Number(ohmResult?.chunkCount || 0));

      const metrics = buildRoundMetrics({
        ohmResult,
        evaluation,
        mseCoefficient,
        mseSource: mseCoefficient === 1 ? 'manual-default' : 'manual-adjusted',
        mseMeasured: false,
        cvrTargetRawUnits,
        cvrSource,
        cciCards,
      });

      // --- Win condition evaluation (layered, most specific first) ---
      const rawVolt = Number(ohmResult?.voltage ?? ohmResult?.totalOhm ?? 0);
      const semanticPct = evaluation.matchScore;

      let winnerRole: 'captain' | 'crew';
      let endReason: RoomRoundDoc['endReason'];

      // 1. CVR out-of-range: Captain's prompt too easy or too hard → crew auto-wins
      if (ohmResult && (rawVolt < cvrMinVolt || rawVolt > cvrMaxVolt)) {
        winnerRole = 'crew';
        endReason = 'cvr_out_of_range';
      // 2. Perfect crew: 100% semantic and MSE ≥ 1 → crew auto-wins
      } else if (enablePerfectCrewBonus && semanticPct >= 100 && mseCoefficient >= 1) {
        winnerRole = 'crew';
        endReason = 'perfect_crew';
      // 3. Normal CPD threshold
      } else {
        winnerRole = semanticPct >= crewWinThreshold ? 'crew' : 'captain';
        endReason = 'meaning';
      }

      await updateDoc(roundRef, {
        meaningScore: semanticPct,
        feedback: evaluation.reason,
        meaningAnalysis: evaluation,
        ohmResult: ohmResult || null,
        metrics,
        reactionDelayMs: reactionDelayMs ?? null,
        winnerRole,
        endReason,
        status: 'finished',
      });

      // --- Scoreboard + team rotation transaction ---
      await runTransaction(db, async (tx) => {
        const roomRef = doc(db, 'rooms', roomId);
        const snap = await tx.get(roomRef);
        if (!snap.exists()) return;
        const roomData = snap.data() as any;

        tx.update(roomRef, buildRoomWinUpdates({
          roomData,
          winnerRole,
          targetPoints,
          swapAfterRoundSetting,
        }));
      });
    } finally {
      setProcessing(false);
    }
  }, [crewRecorder, currentRound, roomId, crewWinThreshold, targetPoints, mseCoefficient, cvrTargetRawUnits, cvrMinVolt, cvrMaxVolt, enablePerfectCrewBonus, swapAfterRoundSetting]);

  return {
    user,
    processing,
    currentRound,
    isCaptain,
    isCrew,
    canStartRound,
    canStartCaptain,
    canStartCrew,
    crewCountdownLabel,
    crewRemainingMs,
    createRoom,
    joinRole,
    startRound,
    swapRoles,
    finishCurrentRound,
    captainRecorder,
    crewRecorder,
    startCaptain,
    stopCaptain,
    startCrew,
    stopCrew,
  };
}
