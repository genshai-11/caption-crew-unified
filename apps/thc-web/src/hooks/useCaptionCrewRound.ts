import { useCallback, useEffect, useRef, useState } from 'react';
import { evaluateCaptionCrewMeaning } from '@/services/meaningService';
import { uploadRoundAudio } from '@/services/roundAudioStorage';
import { defaultGameSettings, loadSettings, saveRound } from '@/services/roundRepository';
import { createDeepgramStreamingSession, DeepgramStreamingSession } from '@/services/deepgramStreamingService';
import { transcribeRoundAudio } from '@/services/transcriptionService';
import { analyzeTranscript, type OhmAnalysisResult } from '@/services/aiService';
import { calculateSemanticOhm, detectSemanticChunksFromCaptain, getDifficultyLabel } from '@/lib/ohmCalculator';
import { buildRoundMetrics, CciCard, GameSettings, MeaningEvaluation, OhmResult, RoundMetrics, RoundRecord, RoundState, TranscriptResult } from '@/types';
import { loadAdminRuntimeConfig } from '@/services/adminConfigRepository';
import { useRoundRecorder } from './useRoundRecorder';

function createRoundId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isUsableTranscript(result: TranscriptResult | null | undefined) {
  return !!result?.transcript?.trim();
}

function toOhmScore(voltage: number) {
  if (voltage <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((voltage / 120) * 100)));
}

export function resolveCrewResponseCoefficient(
  delayMs: number | null,
  timingConfig?: { fullScoreMs?: number; minScoreMs?: number; minCoefficient?: number },
) {
  const fullScoreMs = Number(timingConfig?.fullScoreMs ?? 1000);
  const minScoreMsRaw = Number(timingConfig?.minScoreMs ?? 3000);
  const minScoreMs = Math.max(fullScoreMs + 1, minScoreMsRaw);
  const minCoefficient = Math.max(0, Math.min(1, Number(timingConfig?.minCoefficient ?? 0)));

  if (typeof delayMs !== 'number' || Number.isNaN(delayMs) || delayMs <= fullScoreMs) return 1;
  if (delayMs >= minScoreMs) return minCoefficient;

  const span = Math.max(1, minScoreMs - fullScoreMs);
  const ratio = (delayMs - fullScoreMs) / span;
  return Math.max(minCoefficient, 1 - ratio * (1 - minCoefficient));
}

const ROLE_SETUP_KEY = 'cc-faceoff-role-setup-v1';
const FALLBACK_CCI_CARD: CciCard = { id: '1-on-1', label: '1-on-1', baseA: 10, icon: 'hand', active: true, order: 0 };

function getAvailableCciCards() {
  const cards = loadAdminRuntimeConfig().cciCards
    .filter((card) => card.active !== false && Number(card.baseA) > 0)
    .sort((a, b) => a.order - b.order);
  return cards.length > 0 ? cards : [FALLBACK_CCI_CARD];
}

function getCciCardById(cards: CciCard[], cardId?: string | null) {
  return cards.find((card) => card.id === cardId) || cards[0] || FALLBACK_CCI_CARD;
}

function buildLocalOhmFallback(
  transcript: string,
  reactionDelayMs: number | null,
  runtimeConfig: ReturnType<typeof loadAdminRuntimeConfig>,
): OhmResult {
  const localResponseCoefficient = resolveCrewResponseCoefficient(reactionDelayMs, runtimeConfig.ohmResponseTiming);
  const semanticChunks = detectSemanticChunksFromCaptain(transcript, runtimeConfig.semanticRuleOverrides);
  const sentences = String(transcript || '').split(/[.!?\n\r]+/).map((s) => s.trim()).filter(Boolean).length || 1;
  const words = String(transcript || '').trim().split(/\s+/).filter(Boolean).length;
  const { ohmLengthConstraints: constraints, ohmLengthCoefficients: coef } = runtimeConfig;
  let lengthCoefficient = coef.medium;
  if (sentences <= constraints.veryShort.maxSentences && words <= constraints.veryShort.maxWords) lengthCoefficient = coef.veryShort;
  else if (sentences <= constraints.short.maxSentences && words <= constraints.short.maxWords) lengthCoefficient = coef.short;
  else if (sentences <= constraints.long.maxSentences && words <= constraints.long.maxWords) lengthCoefficient = coef.long;
  else if (sentences > constraints.long.maxSentences || words > constraints.long.maxWords) lengthCoefficient = coef.overLong;
  const rawOhm = calculateSemanticOhm(semanticChunks, lengthCoefficient);
  const adjustedTotalOhm = Number((rawOhm.totalOhm * localResponseCoefficient).toFixed(4));
  return {
    ...rawOhm,
    totalOhm: adjustedTotalOhm,
    formula: localResponseCoefficient < 0.999
      ? `${rawOhm.formula} x ${localResponseCoefficient.toFixed(2)}`
      : rawOhm.formula,
    voltage: adjustedTotalOhm,
    score: toOhmScore(adjustedTotalOhm),
    difficulty: getDifficultyLabel(adjustedTotalOhm),
    chunkCount: semanticChunks.length,
    baseOhm: rawOhm.totalOhm / Math.max(lengthCoefficient, 0.0001),
    estimatedTC: rawOhm.totalOhm / Math.max(lengthCoefficient, 0.0001),
    linguisticComplexity: lengthCoefficient,
    tensionLoad: 1,
    responseCoefficient: localResponseCoefficient,
    repeatCoefficient: 1,
    chunks: semanticChunks.map((chunk) => ({ text: chunk.text, label: chunk.label, ohm: chunk.ohm || 0 })),
  };
}

function buildOhmResultFromAiAnalysis(
  aiAnalysis: OhmAnalysisResult,
  localResponseCoefficient: number,
): OhmResult {
  const lengthCoefficient = typeof aiAnalysis.lengthCoefficient === 'number' && aiAnalysis.lengthCoefficient > 0
    ? aiAnalysis.lengthCoefficient : 1;
  const serverAppliedResponse = aiAnalysis.responseCoefficientApplied === true;
  const responseCoefficient = serverAppliedResponse
    ? (typeof aiAnalysis.responseCoefficient === 'number' && aiAnalysis.responseCoefficient > 0
        ? aiAnalysis.responseCoefficient : 1)
    : localResponseCoefficient;
  const adjustedTotalOhm = serverAppliedResponse
    ? Number(aiAnalysis.totalOhm.toFixed(4))
    : Number((aiAnalysis.totalOhm * responseCoefficient).toFixed(4));
  return {
    totalOhm: adjustedTotalOhm,
    formula: responseCoefficient < 0.999
      ? `${aiAnalysis.formula} x ${responseCoefficient.toFixed(2)}`
      : aiAnalysis.formula,
    current: lengthCoefficient,
    voltage: adjustedTotalOhm,
    score: toOhmScore(adjustedTotalOhm),
    difficulty: getDifficultyLabel(adjustedTotalOhm),
    chunkCount: aiAnalysis.chunks.length,
    baseOhm: typeof aiAnalysis.baseOhm === 'number' ? aiAnalysis.baseOhm : undefined,
    estimatedTC: typeof aiAnalysis.estimatedTC === 'number' ? aiAnalysis.estimatedTC
      : typeof aiAnalysis.baseOhm === 'number' ? aiAnalysis.baseOhm : undefined,
    confirmedTC: typeof aiAnalysis.confirmedTC === 'number' ? aiAnalysis.confirmedTC : undefined,
    candidateTC: typeof aiAnalysis.candidateTC === 'number' ? aiAnalysis.candidateTC : undefined,
    linguisticComplexity: lengthCoefficient,
    tensionLoad: typeof aiAnalysis.topicLevel === 'number' ? aiAnalysis.topicLevel : undefined,
    responseCoefficient,
    repeatCoefficient: 1,
    chunks: aiAnalysis.chunks
      .map((chunk) => ({ ...chunk, label: String(chunk.label || '').toUpperCase() }))
      .filter((chunk) => ['GREEN', 'BLUE', 'RED', 'PINK'].includes(chunk.label))
      .map((chunk) => ({ text: chunk.text, label: chunk.label as 'GREEN' | 'BLUE' | 'RED' | 'PINK', ohm: Number(chunk.ohm || 0) })),
  };
}

function shouldUseDeepgramLivePartial() {
  const config = loadAdminRuntimeConfig();
  return config.transcriptProvider === 'deepgram' && config.partialTranscriptEnabled === true;
}

function createLocalPlayerId(role: 'captain' | 'crew') {
  return `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useCaptionCrewRound() {
  const captainRecorder = useRoundRecorder();
  const crewRecorder = useRoundRecorder();

  const [state, setState] = useState<RoundState>('captain-ready');
  const [settings, setSettings] = useState<GameSettings>(defaultGameSettings);
  const [captainTranscript, setCaptainTranscript] = useState<TranscriptResult | null>(null);
  const [crewTranscript, setCrewTranscript] = useState<TranscriptResult | null>(null);
  const [captainVerifiedTranscript, setCaptainVerifiedTranscript] = useState<TranscriptResult | null>(null);
  const [crewVerifiedTranscript, setCrewVerifiedTranscript] = useState<TranscriptResult | null>(null);
  const [captainAudioBlob, setCaptainAudioBlob] = useState<Blob | null>(null);
  const [captainAudioUrl, setCaptainAudioUrl] = useState<string | null>(null);
  const [crewAudioUrl, setCrewAudioUrl] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<MeaningEvaluation | null>(null);
  const [ohmResult, setOhmResult] = useState<OhmResult | null>(null);
  const [metrics, setMetrics] = useState<RoundMetrics | null>(null);
  const [reactionDelayMs, setReactionDelayMs] = useState<number | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [countdownMs, setCountdownMs] = useState<number | null>(null);
  const [captainLiveTranscript, setCaptainLiveTranscript] = useState('');
  const [crewLiveTranscript, setCrewLiveTranscript] = useState('');
  const [captainStreamingStatus, setCaptainStreamingStatus] = useState('Ready for live Vietnamese transcript');
  const [crewStreamingStatus, setCrewStreamingStatus] = useState('Ready for live English transcript');
  const [captainName, setCaptainName] = useState('');
  const [crewName, setCrewName] = useState('');
  const [captainPlayerId, setCaptainPlayerId] = useState<string | null>(null);
  const [crewPlayerId, setCrewPlayerId] = useState<string | null>(null);
  const [availableCciCards, setAvailableCciCards] = useState<CciCard[]>(() => getAvailableCciCards());
  const [selectedCciCardId, setSelectedCciCardId] = useState(() => getAvailableCciCards()[0]?.id || FALLBACK_CCI_CARD.id);
  const [lockedCciCard, setLockedCciCard] = useState<CciCard>(() => getAvailableCciCards()[0] || FALLBACK_CCI_CARD);
  const [currentRoundId, setCurrentRoundId] = useState<string | null>(null);

  const captainAudioBlobRef = useRef<Blob | null>(null);
  const captainStoppedAtRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);
  const captainBatchTranscriptPromiseRef = useRef<Promise<TranscriptResult> | null>(null);
  const captainPrimaryTranscriptPromiseRef = useRef<Promise<TranscriptResult> | null>(null);
  const captainOhmPromiseRef = useRef<Promise<OhmAnalysisResult | null> | null>(null);
  const captainStreamingSessionRef = useRef<DeepgramStreamingSession | null>(null);
  const crewStreamingSessionRef = useRef<DeepgramStreamingSession | null>(null);
  const activeRoundTokenRef = useRef(0);
  const currentRoundRecordRef = useRef<RoundRecord | null>(null);

  useEffect(() => {
    loadSettings().then(setSettings).catch(() => undefined);
    try {
      const saved = JSON.parse(localStorage.getItem(ROLE_SETUP_KEY) || '{}');
      setCaptainName(String(saved.captainName || ''));
      setCrewName(String(saved.crewName || ''));
      setCaptainPlayerId(saved.captainPlayerId ? String(saved.captainPlayerId) : null);
      setCrewPlayerId(saved.crewPlayerId ? String(saved.crewPlayerId) : null);
    } catch {
      // ignore invalid local setup
    }
  }, []);

  const persistRoleSetup = useCallback((next: {
    captainName: string;
    crewName: string;
    captainPlayerId: string;
    crewPlayerId: string;
  }) => {
    localStorage.setItem(ROLE_SETUP_KEY, JSON.stringify(next));
    setCaptainName(next.captainName);
    setCrewName(next.crewName);
    setCaptainPlayerId(next.captainPlayerId);
    setCrewPlayerId(next.crewPlayerId);
  }, []);

  const saveRoleSetup = useCallback((nextCaptainName: string, nextCrewName: string) => {
    const trimmedCaptain = nextCaptainName.trim().slice(0, 40);
    const trimmedCrew = nextCrewName.trim().slice(0, 40);
    if (!trimmedCaptain || !trimmedCrew) return false;

    persistRoleSetup({
      captainName: trimmedCaptain,
      crewName: trimmedCrew,
      captainPlayerId: captainPlayerId || createLocalPlayerId('captain'),
      crewPlayerId: crewPlayerId || createLocalPlayerId('crew'),
    });
    return true;
  }, [captainPlayerId, crewPlayerId, persistRoleSetup]);

  const swapRoles = useCallback(() => {
    if (!captainName.trim() || !crewName.trim()) return;
    persistRoleSetup({
      captainName: crewName,
      crewName: captainName,
      captainPlayerId: crewPlayerId || createLocalPlayerId('captain'),
      crewPlayerId: captainPlayerId || createLocalPlayerId('crew'),
    });
  }, [captainName, captainPlayerId, crewName, crewPlayerId, persistRoleSetup]);

  const clearCrewTimers = useCallback(() => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    if (countdownIntervalRef.current) window.clearInterval(countdownIntervalRef.current);
    timeoutRef.current = null;
    countdownIntervalRef.current = null;
    setCountdownMs(null);
  }, []);

  const startCaptainTranscriptionPrefetch = useCallback((blob: Blob) => {
    const roundToken = activeRoundTokenRef.current;
    const promise = transcribeRoundAudio(blob, { role: 'captain', language: 'vi', preferServerConfig: true })
      .then((result) => {
        if (activeRoundTokenRef.current === roundToken) {
          setCaptainVerifiedTranscript(result);
        }
        return result;
      });

    captainBatchTranscriptPromiseRef.current = promise;
    return promise;
  }, []);

  const beginStreamingSession = useCallback((
    role: 'captain' | 'crew',
    language: 'vi' | 'en',
    setLiveTranscript: (value: string) => void,
    setStatus: (value: string) => void,
  ) => {
    const roundToken = activeRoundTokenRef.current;
    const session = createDeepgramStreamingSession({
      role,
      language,
      onPartialTranscript: (transcript) => {
        if (activeRoundTokenRef.current !== roundToken) return;
        setLiveTranscript(transcript);
      },
      onStatusChange: (status) => {
        if (activeRoundTokenRef.current !== roundToken) return;
        setStatus(status);
      },
      onError: (error) => {
        console.warn(`${role} streaming error`, error);
      },
    });

    return session;
  }, []);

  const resolvePrimaryTranscript = useCallback(async ({
    session,
    fallbackPromise,
    role,
    language,
    setPrimaryTranscript,
    setVerifiedTranscript,
    setLiveTranscript,
    setStatus,
  }: {
    session: DeepgramStreamingSession | null;
    fallbackPromise: Promise<TranscriptResult>;
    role: 'captain' | 'crew';
    language: 'vi' | 'en';
    setPrimaryTranscript: (value: TranscriptResult) => void;
    setVerifiedTranscript: (value: TranscriptResult) => void;
    setLiveTranscript: (value: string) => void;
    setStatus: (value: string) => void;
  }) => {
    try {
      if (!session) throw new Error(`No live ${role} streaming session`);
      const streamingResult = await session.finalize();
      if (isUsableTranscript(streamingResult)) {
        setPrimaryTranscript(streamingResult);
        setLiveTranscript(streamingResult.transcript);
        setStatus('Live transcript ready — batch verification continuing in background');
        void fallbackPromise
          .then((verified) => {
            setVerifiedTranscript(verified);
            if (!isUsableTranscript(verified)) return;
            if (verified.transcript.trim() !== streamingResult.transcript.trim()) {
              setStatus('Live transcript ready — verified transcript saved in background');
            }
          })
          .catch(() => undefined);
        return streamingResult;
      }
      throw new Error(`Empty live ${role} transcript`);
    } catch (streamingError) {
      console.warn(`${role} streaming finalize failed, falling back to batch`, streamingError);
      const fallbackResult = await fallbackPromise;
      const merged: TranscriptResult = {
        ...fallbackResult,
        source: 'streaming-fallback-batch',
      };
      setPrimaryTranscript(merged);
      setVerifiedTranscript(fallbackResult);
      setLiveTranscript(merged.transcript);
      setStatus(`Live transcript unavailable — using verified ${language === 'vi' ? 'Vietnamese' : 'English'} batch transcript`);
      return merged;
    }
  }, []);

  const resetRound = useCallback((options?: { preserveSelectedCciCard?: boolean }) => {
    const cards = getAvailableCciCards();
    const nextSelected = options?.preserveSelectedCciCard
      ? getCciCardById(cards, selectedCciCardId)
      : getCciCardById(cards, FALLBACK_CCI_CARD.id);

    activeRoundTokenRef.current += 1;
    captainStreamingSessionRef.current?.close();
    crewStreamingSessionRef.current?.close();
    captainStreamingSessionRef.current = null;
    crewStreamingSessionRef.current = null;
    captainRecorder.reset();
    crewRecorder.reset();
    setAvailableCciCards(cards);
    setSelectedCciCardId(nextSelected.id);
    setLockedCciCard(nextSelected);
    setCurrentRoundId(null);
    currentRoundRecordRef.current = null;
    setState('captain-ready');
    setCaptainTranscript(null);
    setCrewTranscript(null);
    setCaptainVerifiedTranscript(null);
    setCrewVerifiedTranscript(null);
    setCaptainAudioBlob(null);
    setCaptainAudioUrl(null);
    setCrewAudioUrl(null);
    setEvaluation(null);
    setOhmResult(null);
    setMetrics(null);
    setReactionDelayMs(null);
    setFeedbackError(null);
    setCaptainLiveTranscript('');
    setCrewLiveTranscript('');
    setCaptainStreamingStatus('Ready for live Vietnamese transcript');
    setCrewStreamingStatus('Ready for live English transcript');
    captainAudioBlobRef.current = null;
    captainStoppedAtRef.current = null;
    captainBatchTranscriptPromiseRef.current = null;
    captainPrimaryTranscriptPromiseRef.current = null;
    captainOhmPromiseRef.current = null;
    clearCrewTimers();
  }, [captainRecorder, clearCrewTimers, crewRecorder, selectedCciCardId]);

  const replaceLearners = useCallback((nextCaptainName: string, nextCrewName: string) => {
    const trimmedCaptain = nextCaptainName.trim().slice(0, 40);
    const trimmedCrew = nextCrewName.trim().slice(0, 40);
    if (!trimmedCaptain || !trimmedCrew) return false;

    resetRound();
    persistRoleSetup({
      captainName: trimmedCaptain,
      crewName: trimmedCrew,
      captainPlayerId: createLocalPlayerId('captain'),
      crewPlayerId: createLocalPlayerId('crew'),
    });
    return true;
  }, [persistRoleSetup, resetRound]);

  const endRound = useCallback(() => {
    resetRound();
  }, [resetRound]);

  const startCaptain = useCallback(async () => {
    const cards = getAvailableCciCards();
    const selectedCard = getCciCardById(cards, selectedCciCardId);
    resetRound({ preserveSelectedCciCard: true });
    setAvailableCciCards(cards);
    setSelectedCciCardId(selectedCard.id);
    setLockedCciCard(selectedCard);
    setState('captain-recording');

    if (shouldUseDeepgramLivePartial()) {
      setCaptainStreamingStatus('Connecting live Vietnamese transcript…');
      const session = beginStreamingSession('captain', 'vi', setCaptainLiveTranscript, setCaptainStreamingStatus);
      captainStreamingSessionRef.current = session;
      await captainRecorder.start({
        timesliceMs: 250,
        onChunk: (chunk) => session.sendAudioChunk(chunk),
      });
      return;
    }

    setCaptainStreamingStatus('Live partial transcript disabled — using a single batch transcript after stop.');
    captainStreamingSessionRef.current = null;
    await captainRecorder.start();
  }, [beginStreamingSession, captainRecorder, resetRound, selectedCciCardId]);

  const stopCaptain = useCallback(async () => {
    const blob = await captainRecorder.stop();
    if (!blob) {
      setFeedbackError('No Captain audio captured.');
      setState('captain-ready');
      return;
    }

    captainAudioBlobRef.current = blob;
    setCaptainAudioBlob(blob);
    captainStoppedAtRef.current = Date.now();
    setState('crew-waiting');
    setCountdownMs(settings.maxCrewStartDelayMs);

    if (shouldUseDeepgramLivePartial()) {
      const batchPromise = startCaptainTranscriptionPrefetch(blob);
      captainPrimaryTranscriptPromiseRef.current = resolvePrimaryTranscript({
        session: captainStreamingSessionRef.current,
        fallbackPromise: batchPromise,
        role: 'captain',
        language: 'vi',
        setPrimaryTranscript: setCaptainTranscript,
        setVerifiedTranscript: setCaptainVerifiedTranscript,
        setLiveTranscript: setCaptainLiveTranscript,
        setStatus: setCaptainStreamingStatus,
      });
      void captainPrimaryTranscriptPromiseRef.current.catch(() => undefined);
    } else {
      const singlePromise = transcribeRoundAudio(blob, { role: 'captain', language: 'vi', preferServerConfig: true })
        .then((result) => {
          setCaptainTranscript(result);
          setCaptainVerifiedTranscript(result);
          setCaptainLiveTranscript(result.transcript);
          setCaptainStreamingStatus('Captain transcript ready (single batch mode)');
          return result;
        });
      captainBatchTranscriptPromiseRef.current = singlePromise;
      captainPrimaryTranscriptPromiseRef.current = singlePromise;
      void singlePromise.catch(() => undefined);
    }

    // Fire OHM analysis as soon as captain transcript is ready — crew recording is free compute time.
    // reactionDelayMs is not known yet; response coefficient is applied client-side in stopCrew.
    const ohmPrefetchToken = activeRoundTokenRef.current;
    void captainPrimaryTranscriptPromiseRef.current
      ?.then((captainResult) => {
        if (activeRoundTokenRef.current !== ohmPrefetchToken) return;
        const rc = loadAdminRuntimeConfig();
        captainOhmPromiseRef.current = analyzeTranscript(captainResult.transcript, {
          model: rc.ohmModel || rc.router9Model,
          fallbackModel: rc.ohmFallbackModel || rc.router9FallbackModel,
          reactionDelayMs: null,
          useMemoryAssist: rc.ohmAgentEnabled,
          returnDebug: true,
          sessionId: ohmPrefetchToken.toString(),
        }).catch(() => null);
      })
      .catch(() => undefined);

    const waitingStartedAt = Date.now();

    countdownIntervalRef.current = window.setInterval(() => {
      const elapsed = Date.now() - waitingStartedAt;
      setCountdownMs(Math.max(settings.maxCrewStartDelayMs - elapsed, 0));
    }, 100);
  }, [captainRecorder, resolvePrimaryTranscript, settings.maxCrewStartDelayMs, startCaptainTranscriptionPrefetch]);

  const startCrew = useCallback(async () => {
    if (state !== 'crew-waiting') return;
    const delay = Date.now() - (captainStoppedAtRef.current || Date.now());
    setReactionDelayMs(delay);
    clearCrewTimers();
    setState('crew-recording');

    if (shouldUseDeepgramLivePartial()) {
      setCrewStreamingStatus('Connecting live English transcript…');
      const session = beginStreamingSession('crew', 'en', setCrewLiveTranscript, setCrewStreamingStatus);
      crewStreamingSessionRef.current = session;
      await crewRecorder.start({
        timesliceMs: 250,
        onChunk: (chunk) => session.sendAudioChunk(chunk),
      });
      return;
    }

    setCrewStreamingStatus('Live partial transcript disabled — using a single batch transcript after stop.');
    crewStreamingSessionRef.current = null;
    await crewRecorder.start();
  }, [beginStreamingSession, clearCrewTimers, crewRecorder, state]);

  const stopCrew = useCallback(async () => {
    performance.mark('stopCrew:start');
    setState('crew-processing');
    const crewBlob = await crewRecorder.stop();
    if (!crewBlob) {
      setFeedbackError('No Crew audio captured.');
      setState('crew-waiting');
      return;
    }

    if (!captainAudioBlobRef.current) {
      setFeedbackError('Captain audio is missing. Please try again.');
      setState('captain-ready');
      return;
    }

    try {
      const roundToken = activeRoundTokenRef.current;
      const livePartialEnabled = shouldUseDeepgramLivePartial();
      const captainBatchPromise = captainBatchTranscriptPromiseRef.current || startCaptainTranscriptionPrefetch(captainAudioBlobRef.current);

      let crewBatchPromise: Promise<TranscriptResult>;
      let captainPromise: Promise<TranscriptResult>;
      let crewPromise: Promise<TranscriptResult>;

      if (livePartialEnabled) {
        crewBatchPromise = transcribeRoundAudio(crewBlob, { role: 'crew', language: 'en' })
          .then((result) => {
            if (activeRoundTokenRef.current === roundToken) {
              setCrewVerifiedTranscript(result);
            }
            return result;
          });

        captainPromise = captainPrimaryTranscriptPromiseRef.current || resolvePrimaryTranscript({
          session: captainStreamingSessionRef.current,
          fallbackPromise: captainBatchPromise,
          role: 'captain',
          language: 'vi',
          setPrimaryTranscript: setCaptainTranscript,
          setVerifiedTranscript: setCaptainVerifiedTranscript,
          setLiveTranscript: setCaptainLiveTranscript,
          setStatus: setCaptainStreamingStatus,
        });

        crewPromise = resolvePrimaryTranscript({
          session: crewStreamingSessionRef.current,
          fallbackPromise: crewBatchPromise,
          role: 'crew',
          language: 'en',
          setPrimaryTranscript: setCrewTranscript,
          setVerifiedTranscript: setCrewVerifiedTranscript,
          setLiveTranscript: setCrewLiveTranscript,
          setStatus: setCrewStreamingStatus,
        });
      } else {
        crewBatchPromise = transcribeRoundAudio(crewBlob, { role: 'crew', language: 'en', preferServerConfig: true })
          .then((result) => {
            if (activeRoundTokenRef.current === roundToken) {
              setCrewVerifiedTranscript(result);
              setCrewStreamingStatus('Crew transcript ready (single batch mode)');
            }
            return result;
          });

        captainPromise = captainPrimaryTranscriptPromiseRef.current || captainBatchPromise;
        crewPromise = crewBatchPromise;
      }

      const [captainResult, crewResult] = await Promise.all([captainPromise, crewPromise]);
      performance.mark('stopCrew:transcripts-done');
      performance.measure('transcripts', 'stopCrew:start', 'stopCrew:transcripts-done');

      setCaptainTranscript(captainResult);
      setCrewTranscript(crewResult);
      if (!livePartialEnabled) {
        setCrewLiveTranscript(crewResult.transcript);
      }

      const runtimeConfig = loadAdminRuntimeConfig();

      // === PHASE 1: show results immediately with local sync OHM fallback ===
      const localOhmResult = buildLocalOhmFallback(captainResult.transcript, reactionDelayMs, runtimeConfig);
      setOhmResult(localOhmResult);
      setState('results');  // navigate fires here; evaluation skeleton shown on summary page

      // === PHASE 2: parallel AI calls — OHM likely already prefetched during crew recording ===
      const localResponseCoefficient = resolveCrewResponseCoefficient(reactionDelayMs, runtimeConfig.ohmResponseTiming);
      const ohmAiPromise = captainOhmPromiseRef.current
        ?? analyzeTranscript(captainResult.transcript, {
          model: runtimeConfig.ohmModel || runtimeConfig.router9Model,
          fallbackModel: runtimeConfig.ohmFallbackModel || runtimeConfig.router9FallbackModel,
          reactionDelayMs,
          useMemoryAssist: runtimeConfig.ohmAgentEnabled,
          returnDebug: true,
          sessionId: roundToken.toString(),
        }).catch(() => null);

      const [aiAnalysis, result] = await Promise.all([
        ohmAiPromise,
        evaluateCaptionCrewMeaning({
          captainTranscript: captainResult.transcript,
          crewTranscript: crewResult.transcript,
          strictness: settings.strictness,
        }),
      ]);
      performance.mark('stopCrew:ohm-done');
      performance.mark('stopCrew:meaning-done');
      performance.measure('ohm+meaning-parallel', 'stopCrew:transcripts-done', 'stopCrew:meaning-done');

      if (activeRoundTokenRef.current !== roundToken) return;

      const nextOhmResult = aiAnalysis
        ? buildOhmResultFromAiAnalysis(aiAnalysis, localResponseCoefficient)
        : localOhmResult;
      if (aiAnalysis) setOhmResult(nextOhmResult);

      const nextMetrics = buildRoundMetrics({
        ohmResult: nextOhmResult,
        evaluation: result,
        mseCoefficient: 1,
        mseSource: 'manual-default',
        mseMeasured: false,
        cciCard: lockedCciCard,
        cvrSource: 'cvr-analysis',
      });

      setMetrics(nextMetrics);
      setEvaluation(result);
      // setState('results') already called above

      const roundId = createRoundId();
      setCurrentRoundId(roundId);
      currentRoundRecordRef.current = {
        id: roundId,
        createdAt: new Date().toISOString(),
        state: 'results',
        captainPlayerId,
        crewPlayerId,
        captainName: captainName || null,
        crewName: crewName || null,
        captainTranscript: captainResult,
        crewTranscript: crewResult,
        ohmResult: nextOhmResult,
        metrics: nextMetrics,
        evaluation: result,
        reactionDelayMs: reactionDelayMs || undefined,
        timeoutLost: false,
      };
      void (async () => {
        try {
          const [captainAudio, crewAudio, captainVerified, crewVerified] = await Promise.all([
            uploadRoundAudio(roundId, 'captain', captainAudioBlobRef.current!).catch((error) => {
              console.warn('Captain audio upload failed; saving round without captain audio.', error);
              return null;
            }),
            uploadRoundAudio(roundId, 'crew', crewBlob).catch((error) => {
              console.warn('Crew audio upload failed; saving round without crew audio.', error);
              return null;
            }),
            captainBatchPromise.catch(() => null),
            crewBatchPromise.catch(() => null),
          ]);

          if (activeRoundTokenRef.current === roundToken) {
            if (captainAudio?.url) setCaptainAudioUrl(captainAudio.url);
            if (crewAudio?.url) setCrewAudioUrl(crewAudio.url);
            if (captainVerified) setCaptainVerifiedTranscript(captainVerified);
            if (crewVerified) setCrewVerifiedTranscript(crewVerified);
          }

          const round: RoundRecord = {
            ...(currentRoundRecordRef.current || {
              id: roundId,
              createdAt: new Date().toISOString(),
              state: 'results',
              timeoutLost: false,
            }),
            captainPlayerId,
            crewPlayerId,
            captainName: captainName || null,
            crewName: crewName || null,
            captainTranscript: captainResult,
            crewTranscript: crewResult,
            captainVerifiedTranscript: captainVerified || undefined,
            crewVerifiedTranscript: crewVerified || undefined,
            ohmResult: nextOhmResult,
            evaluation: result,
            reactionDelayMs: reactionDelayMs || undefined,
            timeoutLost: false,
            captainAudioUrl: captainAudio?.url,
            crewAudioUrl: crewAudio?.url,
            captainAudioPath: captainAudio?.path,
            crewAudioPath: crewAudio?.path,
            captainAudioMimeType: captainAudio?.mimeType,
            crewAudioMimeType: crewAudio?.mimeType,
          };
          currentRoundRecordRef.current = round;
          await saveRound(round);
        } catch (backgroundError) {
          console.warn('Background save failed', backgroundError);
        }
      })();
    } catch (error: any) {
      setFeedbackError(error.message || 'Analysis failed.');
      setState('results');
    }
  }, [captainName, captainPlayerId, crewName, crewPlayerId, crewRecorder, lockedCciCard, reactionDelayMs, resolvePrimaryTranscript, settings.strictness, startCaptainTranscriptionPrefetch]);

  const selectCciCard = useCallback((cardId: string) => {
    if (state !== 'captain-ready') return;
    const cards = getAvailableCciCards();
    const selected = getCciCardById(cards, cardId);
    setAvailableCciCards(cards);
    setSelectedCciCardId(selected.id);
    setLockedCciCard(selected);
  }, [state]);

  const saveSummaryMse = useCallback(async (mseCoefficient: number) => {
    const roundRecord = currentRoundRecordRef.current;
    if (!roundRecord || !currentRoundId) throw new Error('Current round is not ready to save yet.');

    const normalizedMse = Math.max(0, Number(mseCoefficient || 0));
    const appliedCard = roundRecord.metrics?.cci.card || lockedCciCard;
    const nextMetrics = buildRoundMetrics({
      ohmResult: roundRecord.ohmResult,
      evaluation: roundRecord.evaluation,
      mseCoefficient: normalizedMse,
      mseSource: normalizedMse === 1 ? 'manual-default' : 'manual-adjusted',
      mseMeasured: false,
      cciCard: appliedCard,
      cvrSource: roundRecord.metrics?.cvr.source || 'cvr-analysis',
    });
    const nextRound: RoundRecord = {
      ...roundRecord,
      metrics: nextMetrics,
    };

    currentRoundRecordRef.current = nextRound;
    setMetrics(nextMetrics);
    await saveRound(nextRound);
    return nextMetrics;
  }, [currentRoundId, lockedCciCard]);

  useEffect(() => () => clearCrewTimers(), [clearCrewTimers]);

  useEffect(() => () => {
    captainStreamingSessionRef.current?.close();
    crewStreamingSessionRef.current?.close();
  }, []);

  return {
    state,
    settings,
    setSettings,
    captainRecorder,
    crewRecorder,
    captainName,
    crewName,
    captainPlayerId,
    crewPlayerId,
    availableCciCards,
    selectedCciCardId,
    selectedCciCard: getCciCardById(availableCciCards, selectedCciCardId),
    lockedCciCard,
    rolesConfigured: !!captainName.trim() && !!crewName.trim(),
    saveRoleSetup,
    replaceLearners,
    swapRoles,
    endRound,
    selectCciCard,
    saveSummaryMse,
    captainTranscript,
    crewTranscript,
    captainVerifiedTranscript,
    crewVerifiedTranscript,
    captainLiveTranscript,
    crewLiveTranscript,
    captainStreamingStatus,
    crewStreamingStatus,
    captainAudioBlob,
    captainAudioUrl,
    crewAudioBlob: crewRecorder.audioBlob,
    crewAudioUrl,
    evaluation,
    ohmResult,
    metrics,
    feedbackError,
    reactionDelayMs,
    countdownMs,
    canStartCaptain: state === 'captain-ready',
    canStartCrew: state === 'crew-waiting',
    startCaptain,
    stopCaptain,
    startCrew,
    stopCrew,
    resetRound,
    currentRoundId,
  };
}
