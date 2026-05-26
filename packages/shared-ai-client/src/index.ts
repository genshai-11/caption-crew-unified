import type { MeaningEvaluation, TranscriptResult } from '@caption-crew/shared-types';

export type TranscriptProvider = 'deepgram' | 'google' | 'thirdparty';

export interface SharedTranscriptConfig {
  transcribeUrl: string;
  deepgramTokenUrl?: string;
  transcriptProvider?: TranscriptProvider;
  captainDeepgramModel?: string;
  crewDeepgramModel?: string;
  googleTranscriptModel?: string;
  googleCloudProjectId?: string;
  googleTranscriptLocation?: string;
  thirdPartyTranscriptModel?: string;
  deepgramApiKey?: string;
  googleApiKey?: string;
  thirdPartyTranscriptApiKey?: string;
  thirdPartyTranscriptUrl?: string;
  thirdPartyTranscriptAuthScheme?: 'none' | 'bearer' | 'x-api-key';
}

export interface SharedMeaningConfig {
  evaluateMeaningUrl: string;
  meaningStrictness?: 'loose' | 'medium' | 'strict';
  meaningWeight?: number;
  feedbackEnabled?: boolean;
  feedbackMode?: 'off' | 'gentle' | 'balanced' | 'detailed';
  feedbackTone?: string;
  showGrammarReminder?: boolean;
  showImprovedSentence?: boolean;
  showWhenMeaningCorrect?: boolean;
  onlyIfAffectsClarity?: boolean;
}

export interface SemanticChunk {
  text: string;
  label: 'GREEN' | 'BLUE' | 'RED' | 'PINK' | 'NONE';
  ohm: number;
  confidence: number;
  reason: string;
}

export interface OhmAnalysisResult {
  transcriptRaw: string;
  transcriptNormalized: string;
  chunks: SemanticChunk[];
  formula: string;
  totalOhm: number;
  modelUsed?: string;
  analysisSource?: string;
  responseCoefficient?: number;
  responseCoefficientApplied?: boolean;
  agentDiagnostics?: Record<string, unknown>;
  baseOhm?: number;
  estimatedTC?: number;
  confirmedTC?: number;
  candidateTC?: number;
  lengthBucket?: 'veryShort' | 'short' | 'medium' | 'long' | 'overLong';
  lengthCoefficient?: number;
  topicLevel?: number;
  verifierAppliedCount?: number;
  uncertainChunkCount?: number;
  chunkDiagnostics?: Array<Record<string, unknown>>;
}

export interface SharedOhmConfig {
  analyzeOhmUrl: string;
  ohmModel?: string;
  ohmFallbackModel?: string;
  router9Model?: string;
  router9FallbackModel?: string;
  ohmAgentEnabled?: boolean;
  ohmAgentShadowMode?: boolean;
}

export async function transcribeRoundAudioClient(config: SharedTranscriptConfig, audioBlob: Blob, options: {
  role: 'captain' | 'crew';
  language: 'vi' | 'en';
  providerOverride?: TranscriptProvider;
  deepgramModelOverride?: string;
  googleModelOverride?: string;
  googleProjectIdOverride?: string;
  googleLocationOverride?: string;
  thirdPartyTranscriptModelOverride?: string;
  deepgramApiKeyOverride?: string;
  googleApiKeyOverride?: string;
  thirdPartyTranscriptApiKeyOverride?: string;
  thirdPartyTranscriptUrlOverride?: string;
  thirdPartyTranscriptAuthSchemeOverride?: 'none' | 'bearer' | 'x-api-key';
  preferServerConfig?: boolean;
}): Promise<TranscriptResult> {
  if (!config.transcribeUrl) throw new Error('transcribeUrl is not configured.');
  const transcriptProvider = options.providerOverride || config.transcriptProvider || 'deepgram';
  const selectedDeepgramModel = options.deepgramModelOverride || (options.role === 'captain' ? config.captainDeepgramModel : config.crewDeepgramModel);
  const selectedGoogleModel = String(options.googleModelOverride || config.googleTranscriptModel || 'chirp_3').trim().replace(/[\s.,;:!?]+$/g, '').toLowerCase();
  const selectedGoogleProjectId = options.googleProjectIdOverride || config.googleCloudProjectId || '';
  const selectedGoogleLocation = options.googleLocationOverride || config.googleTranscriptLocation || 'global';
  const selectedThirdPartyModel = options.thirdPartyTranscriptModelOverride || config.thirdPartyTranscriptModel || '';
  const selectedModel = transcriptProvider === 'google' ? selectedGoogleModel : transcriptProvider === 'thirdparty' ? selectedThirdPartyModel : selectedDeepgramModel;
  const mimeType = audioBlob.type || 'audio/webm;codecs=opus';
  const headers: Record<string, string> = { 'Content-Type': mimeType };
  const preferServerConfig = options.preferServerConfig === true;
  const hasAnyOverride = !!(options.providerOverride || options.deepgramModelOverride || options.googleModelOverride || options.googleProjectIdOverride || options.googleLocationOverride || options.thirdPartyTranscriptModelOverride || options.deepgramApiKeyOverride || options.googleApiKeyOverride || options.thirdPartyTranscriptApiKeyOverride || options.thirdPartyTranscriptUrlOverride || options.thirdPartyTranscriptAuthSchemeOverride);

  if (!preferServerConfig || hasAnyOverride) {
    headers['x-transcript-provider'] = transcriptProvider;
    if (selectedDeepgramModel) headers['x-deepgram-model'] = selectedDeepgramModel;
    if (selectedGoogleModel) headers['x-google-model'] = selectedGoogleModel;
    if (selectedGoogleProjectId) headers['x-google-project-id'] = selectedGoogleProjectId;
    if (selectedGoogleLocation) headers['x-google-location'] = selectedGoogleLocation;
    if (selectedThirdPartyModel) headers['x-thirdparty-transcript-model'] = selectedThirdPartyModel;
    const deepgramApiKey = options.deepgramApiKeyOverride || config.deepgramApiKey;
    const googleApiKey = options.googleApiKeyOverride || config.googleApiKey;
    const thirdPartyApiKey = options.thirdPartyTranscriptApiKeyOverride || config.thirdPartyTranscriptApiKey;
    const thirdPartyUrl = options.thirdPartyTranscriptUrlOverride || config.thirdPartyTranscriptUrl;
    const thirdPartyAuthScheme = options.thirdPartyTranscriptAuthSchemeOverride || config.thirdPartyTranscriptAuthScheme;
    if (deepgramApiKey) headers['x-deepgram-api-key'] = deepgramApiKey;
    if (googleApiKey) headers['x-google-api-key'] = googleApiKey;
    if (thirdPartyApiKey) headers['x-thirdparty-transcript-api-key'] = thirdPartyApiKey;
    if (thirdPartyUrl) headers['x-thirdparty-transcript-url'] = thirdPartyUrl;
    if (thirdPartyAuthScheme) headers['x-thirdparty-transcript-auth-scheme'] = thirdPartyAuthScheme;
  }

  const response = await fetch(`${config.transcribeUrl}?role=${options.role}&language=${options.language}`, { method: 'POST', headers, body: audioBlob });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Transcription failed');
  return {
    transcript: String(data.transcript || ''),
    confidence: Number(data.confidence || 0),
    duration: Number(data.duration || 0),
    source: 'batch',
    modelRequested: typeof data.modelRequested === 'string' ? data.modelRequested : selectedModel,
    modelUsed: typeof data.modelUsed === 'string' ? data.modelUsed : selectedModel,
    fallbackUsed: data.fallbackUsed === true,
    requestId: typeof data.requestId === 'string' ? data.requestId : '',
    emptyTranscript: !String(data.transcript || '').trim(),
    roleReceived: typeof data.roleReceived === 'string' ? data.roleReceived : options.role,
    languageReceived: typeof data.languageReceived === 'string' ? data.languageReceived : options.language,
    contentTypeReceived: typeof data.contentTypeReceived === 'string' ? data.contentTypeReceived : mimeType,
    transcriptProviderUsed: typeof data.transcriptProviderUsed === 'string' ? data.transcriptProviderUsed : transcriptProvider,
  };
}

export async function getDeepgramAccessTokenClient(config: SharedTranscriptConfig) {
  if (!config.deepgramTokenUrl) throw new Error('deepgramTokenUrl is not configured.');
  const response = await fetch(config.deepgramTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(config.deepgramApiKey ? { 'x-deepgram-api-key': config.deepgramApiKey } : {}) },
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not create Deepgram access token');
  const accessToken = typeof data.accessToken === 'string' ? data.accessToken : '';
  if (!accessToken) throw new Error('Deepgram access token was empty');
  return { accessToken, expiresIn: Number(data.expiresIn || 0) };
}

export async function evaluateCaptionCrewMeaningClient(config: SharedMeaningConfig, payload: { captainTranscript: string; crewTranscript: string; strictness: 'loose' | 'medium' | 'strict' }): Promise<MeaningEvaluation> {
  if (!config.evaluateMeaningUrl) throw new Error('evaluateMeaningUrl is not configured.');
  const response = await fetch(config.evaluateMeaningUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      captainTranscript: payload.captainTranscript,
      crewTranscript: payload.crewTranscript,
      strictness: config.meaningStrictness || payload.strictness,
      meaningWeight: config.meaningWeight,
      feedbackConfig: {
        enabled: config.feedbackEnabled,
        feedbackMode: config.feedbackMode,
        tone: config.feedbackTone,
        showGrammarReminder: config.showGrammarReminder,
        showImprovedSentence: config.showImprovedSentence,
        showWhenMeaningCorrect: config.showWhenMeaningCorrect,
        onlyIfAffectsClarity: config.onlyIfAffectsClarity,
      },
    }),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Meaning evaluation failed');
  return {
    matchScore: Number(data.matchScore || 0),
    decision: data.decision || 'mismatch',
    reason: data.reason || 'Evaluation completed.',
    missingConcepts: Array.isArray(data.missingConcepts) ? data.missingConcepts : [],
    extraConcepts: Array.isArray(data.extraConcepts) ? data.extraConcepts : [],
    grammarNote: typeof data.grammarNote === 'string' ? data.grammarNote : '',
    improvedTranscript: typeof data.improvedTranscript === 'string' ? data.improvedTranscript : '',
    grammarSeverity: data.grammarSeverity || 'none',
    feedbackType: data.feedbackType || 'off',
  };
}

export async function analyzeTranscriptClient(config: SharedOhmConfig, transcript: string, options?: {
  model?: string;
  fallbackModel?: string;
  reactionDelayMs?: number | null;
  useMemoryAssist?: boolean;
  returnDebug?: boolean;
  sessionId?: string;
  roundId?: string;
  userId?: string;
}): Promise<OhmAnalysisResult> {
  if (!config.analyzeOhmUrl) throw new Error('analyzeOhmUrl is not configured.');
  const response = await fetch(config.analyzeOhmUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript,
      model: options?.model || config.ohmModel || config.router9Model,
      fallbackModel: options?.fallbackModel || config.ohmFallbackModel || config.router9FallbackModel,
      reactionDelayMs: typeof options?.reactionDelayMs === 'number' ? options.reactionDelayMs : undefined,
      useMemoryAssist: options?.useMemoryAssist ?? config.ohmAgentEnabled,
      returnDebug: options?.returnDebug ?? true,
      agentShadowMode: config.ohmAgentShadowMode,
      sessionId: options?.sessionId,
      roundId: options?.roundId,
      userId: options?.userId,
    }),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Transcript analysis failed');
  return {
    transcriptRaw: String(data.transcriptRaw || transcript),
    transcriptNormalized: String(data.transcriptNormalized || ''),
    chunks: Array.isArray(data.chunks) ? data.chunks : [],
    formula: String(data.formula || '0'),
    totalOhm: Number(data.totalOhm || 0),
    modelUsed: typeof data.modelUsed === 'string' ? data.modelUsed : undefined,
    analysisSource: typeof data.analysisSource === 'string' ? data.analysisSource : undefined,
    responseCoefficient: typeof data.responseCoefficient === 'number' ? data.responseCoefficient : undefined,
    responseCoefficientApplied: data.responseCoefficientApplied === true,
    agentDiagnostics: data.agentDiagnostics && typeof data.agentDiagnostics === 'object' ? data.agentDiagnostics : undefined,
    baseOhm: typeof data.baseOhm === 'number' ? data.baseOhm : undefined,
    estimatedTC: typeof data.estimatedTC === 'number' ? data.estimatedTC : typeof data.agentDiagnostics?.tcBreakdown?.estimatedTC === 'number' ? data.agentDiagnostics.tcBreakdown.estimatedTC : undefined,
    confirmedTC: typeof data.confirmedTC === 'number' ? data.confirmedTC : typeof data.agentDiagnostics?.tcBreakdown?.confirmedTC === 'number' ? data.agentDiagnostics.tcBreakdown.confirmedTC : undefined,
    candidateTC: typeof data.candidateTC === 'number' ? data.candidateTC : typeof data.agentDiagnostics?.tcBreakdown?.candidateTC === 'number' ? data.agentDiagnostics.tcBreakdown.candidateTC : undefined,
    lengthBucket: typeof data.lengthBucket === 'string' ? data.lengthBucket : undefined,
    lengthCoefficient: typeof data.lengthCoefficient === 'number' ? data.lengthCoefficient : undefined,
    topicLevel: typeof data.topicLevel === 'number' ? data.topicLevel : typeof data.agentDiagnostics?.tlBreakdown?.tlValue === 'number' ? data.agentDiagnostics.tlBreakdown.tlValue : undefined,
    verifierAppliedCount: typeof data.verifierAppliedCount === 'number' ? data.verifierAppliedCount : undefined,
    uncertainChunkCount: typeof data.uncertainChunkCount === 'number' ? data.uncertainChunkCount : undefined,
    chunkDiagnostics: Array.isArray(data.chunkDiagnostics) ? data.chunkDiagnostics : undefined,
  };
}

