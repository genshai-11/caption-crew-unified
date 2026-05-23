import { useCallback, useEffect, useRef, useState } from 'react';
import { evaluateCaptionCrewMeaning } from '@/services/meaningService';
import { uploadRoundAudio } from '@/services/roundAudioStorage';
import { defaultGameSettings, loadSettings, saveRound } from '@/services/roundRepository';
import { createDeepgramStreamingSession, DeepgramStreamingSession } from '@/services/deepgramStreamingService';
import { transcribeRoundAudio } from '@/services/transcriptionService';
import { analyzeTranscript } from '@/services/aiService';
import { calculateSemanticOhm, detectSemanticChunksFromCaptain, getDifficultyLabel } from '@/lib/ohmCalculator';
import { GameSettings, MeaningEvaluation, OhmResult, RoundRecord, RoundState, TranscriptResult } from '@/types';
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

function resolveCrewResponseCoefficient(
  delayMs: number | null,
  timingConfig?: { fullScoreMs?: number; minScoreMs?: number; minCoefficient?: number },
) {
  const fullScoreMs = Number(timingConfig?.fullScoreMs || 2000);
  const minScoreMs = Number(timingConfig?.minScoreMs || 5000);
  const minCoefficient = Number(timingConfig?.minCoefficient || (1 / 3));

  if (typeof delayMs !== 'number' || Number.isNaN(delayMs) || delayMs <= fullScoreMs) return 1;
  if (delayMs >= minScoreMs) return minCoefficient;

  const span = Math.max(1, minScoreMs - fullScoreMs);
  const ratio = (delayMs - fullScoreMs) / span;
  return 1 - ratio * (1 - minCoefficient);
}

function shouldUseDeepgramLivePartial() {
  const config = loadAdminRuntimeConfig();
  return config.transcriptProvider === 'deepgram' && config.partialTranscriptEnabled === true;
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
  const [reactionDelayMs, setReactionDelayMs] = useState<number | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [countdownMs, setCountdownMs] = useState<number | null>(null);
  const [captainLiveTranscript, setCaptainLiveTranscript] = useState('');
  const [crewLiveTranscript, setCrewLiveTranscript] = useState('');
  const [captainStreamingStatus, setCaptainStreamingStatus] = useState('Ready for live Vietnamese transcript');
  const [crewStreamingStatus, setCrewStreamingStatus] = useState('Ready for live English transcript');

  const captainAudioBlobRef = useRef<Blob | null>(null);
  const captainStoppedAtRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);
  const captainBatchTranscriptPromiseRef = useRef<Promise<TranscriptResult> | null>(null);
  const captainPrimaryTranscriptPromiseRef = useRef<Promise<TranscriptResult> | null>(null);
  const captainStreamingSessionRef = useRef<DeepgramStreamingSession | null>(null);
  const crewStreamingSessionRef = useRef<DeepgramStreamingSession | null>(null);
  const activeRoundTokenRef = useRef(0);

  useEffect(() => {
    loadSettings().then(setSettings).catch(() => undefined);
  }, []);

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

  const resetRound = useCallback(() => {
    activeRoundTokenRef.current += 1;
    captainStreamingSessionRef.current?.close();
    crewStreamingSessionRef.current?.close();
    captainStreamingSessionRef.current = null;
    crewStreamingSessionRef.current = null;
    captainRecorder.reset();
    crewRecorder.reset();
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
    clearCrewTimers();
  }, [captainRecorder, clearCrewTimers, crewRecorder]);

  const startCaptain = useCallback(async () => {
    resetRound();
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
  }, [beginStreamingSession, captainRecorder, resetRound]);

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

    const waitingStartedAt = Date.now();
    timeoutRef.current = window.setTimeout(() => {
      setReactionDelayMs(Date.now() - (captainStoppedAtRef.current || Date.now()));
      setEvaluation({ matchScore: 0, decision: 'timeout', reason: 'Crew started too late.', feedbackType: 'off' });
      setState('crew-timeout');
    }, settings.maxCrewStartDelayMs);

    countdownIntervalRef.current = window.setInterval(() => {
      const elapsed = Date.now() - waitingStartedAt;
      setCountdownMs(Math.max(settings.maxCrewStartDelayMs - elapsed, 0));
    }, 100);
  }, [captainRecorder, resolvePrimaryTranscript, settings.maxCrewStartDelayMs, startCaptainTranscriptionPrefetch]);

  const startCrew = useCallback(async () => {
    if (state !== 'crew-waiting') return;
    const delay = Date.now() - (captainStoppedAtRef.current || Date.now());
    setReactionDelayMs(delay);
    if (delay > settings.maxCrewStartDelayMs) {
      clearCrewTimers();
      setEvaluation({ matchScore: 0, decision: 'timeout', reason: 'Crew started too late.', feedbackType: 'off' });
      setState('crew-timeout');
      return;
    }

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
  }, [beginStreamingSession, clearCrewTimers, crewRecorder, settings.maxCrewStartDelayMs, state]);

  const stopCrew = useCallback(async () => {
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

      setCaptainTranscript(captainResult);
      setCrewTranscript(crewResult);
      if (!livePartialEnabled) {
        setCrewLiveTranscript(crewResult.transcript);
      }

      const runtimeConfig = loadAdminRuntimeConfig();
      const localResponseCoefficient = resolveCrewResponseCoefficient(reactionDelayMs, runtimeConfig.ohmResponseTiming);
      const resolveLengthCoefficient = (text: string) => {
        const sentences = String(text || '').split(/[.!?\n\r]+/).map((s) => s.trim()).filter(Boolean).length || 1;
        const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
        const constraints = runtimeConfig.ohmLengthConstraints;
        const coef = runtimeConfig.ohmLengthCoefficients;

        if (sentences <= constraints.veryShort.maxSentences && words <= constraints.veryShort.maxWords) return coef.veryShort;
        if (sentences <= constraints.short.maxSentences && words <= constraints.short.maxWords) return coef.short;
        if (sentences <= constraints.medium.maxSentences && words <= constraints.medium.maxWords) return coef.medium;
        if (sentences <= constraints.long.maxSentences && words <= constraints.long.maxWords) return coef.long;
        return coef.overLong;
      };

      let nextOhmResult: OhmResult;
      try {
        const aiAnalysis = await analyzeTranscript(captainResult.transcript, {
          model: runtimeConfig.ohmModel || runtimeConfig.router9Model,
          fallbackModel: runtimeConfig.ohmFallbackModel || runtimeConfig.router9FallbackModel,
          reactionDelayMs,
          useMemoryAssist: runtimeConfig.ohmAgentEnabled,
          returnDebug: true,
          sessionId: activeRoundTokenRef.current.toString(),
        });

        const lengthCoefficient = typeof aiAnalysis.lengthCoefficient === 'number' && aiAnalysis.lengthCoefficient > 0
          ? aiAnalysis.lengthCoefficient
          : 1;
        const serverAppliedResponse = aiAnalysis.responseCoefficientApplied === true;
        const responseCoefficient = serverAppliedResponse
          ? (typeof aiAnalysis.responseCoefficient === 'number' && aiAnalysis.responseCoefficient > 0
              ? aiAnalysis.responseCoefficient
              : 1)
          : localResponseCoefficient;
        const adjustedTotalOhm = serverAppliedResponse
          ? Number(aiAnalysis.totalOhm.toFixed(4))
          : Number((aiAnalysis.totalOhm * responseCoefficient).toFixed(4));
        const formula = responseCoefficient < 0.999
          ? `${aiAnalysis.formula} x ${responseCoefficient.toFixed(2)}`
          : aiAnalysis.formula;
        const voltage = adjustedTotalOhm;
        nextOhmResult = {
          totalOhm: adjustedTotalOhm,
          formula,
          current: lengthCoefficient,
          voltage,
          score: toOhmScore(voltage),
          difficulty: getDifficultyLabel(voltage),
          chunkCount: aiAnalysis.chunks.length,
          chunks: aiAnalysis.chunks
            .map((chunk) => ({
              ...chunk,
              label: String(chunk.label || '').toUpperCase(),
            }))
            .filter((chunk) => ['GREEN', 'BLUE', 'RED', 'PINK'].includes(chunk.label))
            .map((chunk) => ({
              text: chunk.text,
              label: chunk.label as 'GREEN' | 'BLUE' | 'RED' | 'PINK',
              ohm: Number(chunk.ohm || 0),
            })),
        };
      } catch (aiError) {
        console.warn('Ohm AI analysis failed, falling back to local rule-based calculation', aiError);
        const semanticChunks = detectSemanticChunksFromCaptain(
          captainResult.transcript,
          runtimeConfig.semanticRuleOverrides,
        );
        const fallbackLengthCoefficient = resolveLengthCoefficient(captainResult.transcript);
        const rawOhm = calculateSemanticOhm(semanticChunks, fallbackLengthCoefficient);
        const responseCoefficient = localResponseCoefficient;
        const adjustedTotalOhm = Number((rawOhm.totalOhm * responseCoefficient).toFixed(4));
        const adjustedFormula = responseCoefficient < 0.999
          ? `${rawOhm.formula} x ${responseCoefficient.toFixed(2)}`
          : rawOhm.formula;
        const adjustedVoltage = adjustedTotalOhm;
        nextOhmResult = {
          ...rawOhm,
          totalOhm: adjustedTotalOhm,
          formula: adjustedFormula,
          voltage: adjustedVoltage,
          score: toOhmScore(adjustedVoltage),
          difficulty: getDifficultyLabel(adjustedVoltage),
          chunkCount: semanticChunks.length,
          chunks: semanticChunks.map((chunk) => ({
            text: chunk.text,
            label: chunk.label,
            ohm: chunk.ohm || 0,
          })),
        };
      }

      setOhmResult(nextOhmResult);

      setState('evaluating');

      const result = await evaluateCaptionCrewMeaning({
        captainTranscript: captainResult.transcript,
        crewTranscript: crewResult.transcript,
        strictness: settings.strictness,
      });

      setEvaluation(result);
      setState('results');

      const roundId = createRoundId();
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
            id: roundId,
            createdAt: new Date().toISOString(),
            state: 'results',
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
          await saveRound(round);
        } catch (backgroundError) {
          console.warn('Background save failed', backgroundError);
        }
      })();
    } catch (error: any) {
      setFeedbackError(error.message || 'Analysis failed.');
      setState('results');
    }
  }, [crewRecorder, reactionDelayMs, resolvePrimaryTranscript, settings.strictness, startCaptainTranscriptionPrefetch]);

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
  };
}
