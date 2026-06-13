export type RoundState =
  | 'captain-ready'
  | 'captain-recording'
  | 'captain-processing'
  | 'crew-waiting'
  | 'crew-timeout'
  | 'crew-recording'
  | 'crew-processing'
  | 'evaluating'
  | 'results';

export type VisualTheme = 'minimal' | 'bold' | 'swiss';
export type Strictness = 'loose' | 'medium' | 'strict';
export type TranscriptSource = 'streaming' | 'batch' | 'streaming-fallback-batch';

export interface GameSettings {
  maxCrewStartDelayMs: number;
  strictness: Strictness;
  showCountdown: boolean;
}

export interface TranscriptResult {
  transcript: string;
  confidence: number;
  duration: number;
  source?: TranscriptSource;
  modelRequested?: string;
  modelUsed?: string;
  fallbackUsed?: boolean;
  requestId?: string;
  emptyTranscript?: boolean;
  roleReceived?: string;
  languageReceived?: string;
  contentTypeReceived?: string;
  transcriptProviderUsed?: string;
}

export interface MeaningEvaluation {
  matchScore: number;
  decision: 'match' | 'partial' | 'mismatch' | 'timeout';
  reason: string;
  missingConcepts?: string[];
  extraConcepts?: string[];
  grammarNote?: string;
  improvedTranscript?: string;
  grammarSeverity?: 'none' | 'minor' | 'medium' | 'major';
  feedbackType?: 'off' | 'gentle' | 'balanced' | 'detailed';
}

export interface OhmChunkResult {
  text: string;
  label: 'GREEN' | 'BLUE' | 'RED' | 'PINK';
  ohm: number;
}

export interface OhmResult {
  totalOhm: number;
  formula: string;
  voltage: number;
  current: number;
  difficulty: string;
  score: number;
  chunkCount: number;
  chunks: OhmChunkResult[];
  baseOhm?: number;
  estimatedTC?: number;
  confirmedTC?: number;
  candidateTC?: number;
  linguisticComplexity?: number;
  tensionLoad?: number;
  responseCoefficient?: number;
  repeatCoefficient?: number;
}

export type MetricColor = 'RED' | 'GREEN' | 'BLUE';
export type MseSource = 'manual-default' | 'manual-adjusted' | 'measured';
export type CciCardIcon = 'hand' | 'users' | 'waves' | 'blocks';

export interface CciCard {
  id: string;
  label: string;
  baseA: number;
  icon: CciCardIcon;
  active: boolean;
  order: number;
}

export interface AppliedCciCard {
  id: string;
  label: string;
  baseA: number;
  icon: CciCardIcon;
}

export interface MseMetric {
  coefficient: number;
  source: MseSource;
  measured: boolean;
}

export interface CvrMetric {
  color: 'RED';
  unit: 'Ω';
  rawUnits: number;
  score: number;
  source: string;
  formula?: string;
  estimatedTC?: number;
  confirmedTC?: number;
  candidateTC?: number;
  lengthCoefficient?: number;
  linguisticComplexity?: number;
  tensionLoad?: number;
  responseCoefficient?: number;
  responseTimeCoefficient?: number;
  repeatCoefficient?: number;
  chunks?: Array<{
    text: string;
    label: 'GREEN' | 'BLUE' | 'RED' | 'PINK';
    value: number;
  }>;
}

export interface CciMetric {
  color: 'GREEN';
  unit: 'A';
  llmMeaningPercent: number;
  mse: MseMetric;
  card: AppliedCciCard;
  current: number;
  score: number;
  formula: 'cciCards × (mseCoefficient + semanticsDecimal)';
}

export interface CpdMetric {
  color: 'BLUE';
  unit: 'V';
  raw: number;
  score: number;
  formula: 'CCI × CVR';
}

export interface RoundMetrics {
  cvr: CvrMetric;
  cci: CciMetric;
  cpd: CpdMetric;
  scoringVersion: 'cvr-cci-cpd-v1' | 'cvr-cci-cpd-v2';
}

export interface BuildRoundMetricsOptions {
  ohmResult?: OhmResult | null;
  evaluation?: MeaningEvaluation | null;
  mseCoefficient?: number;
  mseSource?: MseSource;
  mseMeasured?: boolean;
  cciCard?: Partial<CciCard> | null;
  cvrTargetRawUnits?: number;
  cvrSource?: string;
  /** cciCards = card/count factor used in CCI current; room flow passes the CVR chunk count. */
  cciCards?: number;
}

function clampMetric(value: number, min = 0, max = 100) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function roundMetric(value: number, digits = 4) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function buildCvrMetric(ohmResult?: OhmResult | null, options?: Pick<BuildRoundMetricsOptions, 'cvrTargetRawUnits' | 'cvrSource'>): CvrMetric {
  const rawUnits = Math.max(0, Number(ohmResult?.totalOhm || 0));
  const target = Math.max(1, Number(options?.cvrTargetRawUnits || 120));
  const existingScore = Number(ohmResult?.score);
  const score = clampMetric(Number.isFinite(existingScore) && existingScore > 0 ? existingScore : (rawUnits / target) * 100);
  const chunkTotal = Array.isArray(ohmResult?.chunks)
    ? ohmResult!.chunks.reduce((sum, chunk) => sum + Math.max(0, Number(chunk.ohm || 0)), 0)
    : 0;
  const estimatedTC = Math.max(0, Number(ohmResult?.estimatedTC ?? ohmResult?.baseOhm ?? chunkTotal));
  const lengthCoefficient = Math.max(0, Number(ohmResult?.linguisticComplexity ?? ohmResult?.current ?? 1));
  const responseCoefficient = Math.max(0, Number(ohmResult?.responseCoefficient ?? 1));
  const repeatCoefficient = Math.max(0, Number(ohmResult?.repeatCoefficient ?? 1));
  const denominator = estimatedTC * lengthCoefficient * Math.max(responseCoefficient, 0.0001) * Math.max(repeatCoefficient, 0.0001);
  const inferredTensionLoad = denominator > 0 ? rawUnits / denominator : 1;
  const tensionLoad = Math.max(0, Number((ohmResult?.tensionLoad ?? inferredTensionLoad) || 1));

  return {
    color: 'RED',
    unit: 'Ω',
    rawUnits: roundMetric(rawUnits),
    score: roundMetric(score, 2),
    source: options?.cvrSource || 'legacy-ohm-result',
    formula: ohmResult?.formula || 'estimatedTC × LC × TL × responseTimeCoefficient × repeatCoefficient',
    estimatedTC: roundMetric(estimatedTC, 4),
    confirmedTC: typeof ohmResult?.confirmedTC === 'number' ? roundMetric(ohmResult.confirmedTC, 4) : undefined,
    candidateTC: typeof ohmResult?.candidateTC === 'number' ? roundMetric(ohmResult.candidateTC, 4) : undefined,
    lengthCoefficient: roundMetric(lengthCoefficient, 4),
    linguisticComplexity: roundMetric(lengthCoefficient, 4),
    tensionLoad: roundMetric(tensionLoad, 4),
    responseCoefficient: roundMetric(responseCoefficient, 4),
    responseTimeCoefficient: roundMetric(responseCoefficient, 4),
    repeatCoefficient: roundMetric(repeatCoefficient, 4),
    chunks: Array.isArray(ohmResult?.chunks)
      ? ohmResult!.chunks.map((chunk) => ({
          text: String(chunk.text || ''),
          label: chunk.label,
          value: Number(chunk.ohm || 0),
        }))
      : [],
  };
}

export function buildCciMetric(
  evaluation?: MeaningEvaluation | null,
  mse?: Partial<MseMetric> | null,
  cciCard?: Partial<CciCard> | null,
  options?: { cciCards?: number },
): CciMetric {
  const llmMeaningPercent = clampMetric(Number(evaluation?.matchScore || 0));
  const semanticsDecimal = llmMeaningPercent / 100;
  const coefficient = Math.max(0, Number(mse?.coefficient ?? 1));
  const measured = mse?.measured === true;
  const source = mse?.source || (coefficient === 1 && !measured ? 'manual-default' : 'manual-adjusted');
  const cardBaseA = Math.max(0, Number(cciCard?.baseA ?? 10));
  const effectiveCards = Math.max(1, Number(options?.cciCards ?? cardBaseA));
  const card: AppliedCciCard = {
    id: String(cciCard?.id || '1-on-1'),
    label: String(cciCard?.label || '1-on-1'),
    baseA: roundMetric(effectiveCards, 4),
    icon: cciCard?.icon === 'hand' || cciCard?.icon === 'waves' || cciCard?.icon === 'blocks' ? cciCard.icon : 'hand',
  };
  const current = card.baseA * (coefficient + semanticsDecimal);

  return {
    color: 'GREEN',
    unit: 'A',
    llmMeaningPercent: roundMetric(llmMeaningPercent, 2),
    mse: {
      coefficient: roundMetric(coefficient, 4),
      source,
      measured,
    },
    card,
    current: roundMetric(current, 4),
    score: roundMetric(current, 4),
    formula: 'cciCards × (mseCoefficient + semanticsDecimal)',
  };
}

export function buildCpdMetric(cvr: CvrMetric, cci: CciMetric): CpdMetric {
  const raw = cci.current * cvr.rawUnits;
  const score = cci.current * cvr.score;

  return {
    color: 'BLUE',
    unit: 'V',
    raw: roundMetric(raw),
    score: roundMetric(score, 2),
    formula: 'CCI × CVR',
  };
}

export function buildRoundMetrics(options: BuildRoundMetricsOptions): RoundMetrics {
  const cvr = buildCvrMetric(options.ohmResult, {
    cvrTargetRawUnits: options.cvrTargetRawUnits,
    cvrSource: options.cvrSource,
  });
  const cciCards = options.cciCards != null ? options.cciCards : undefined;
  const cci = buildCciMetric(options.evaluation, {
    coefficient: options.mseCoefficient ?? 1,
    source: options.mseSource || ((options.mseCoefficient ?? 1) === 1 ? 'manual-default' : 'manual-adjusted'),
    measured: options.mseMeasured === true,
  }, options.cciCard, { cciCards });
  const cpd = buildCpdMetric(cvr, cci);

  return {
    cvr,
    cci,
    cpd,
    scoringVersion: 'cvr-cci-cpd-v2',
  };
}

export interface RoundRecord {
  id: string;
  createdAt: string;
  state: RoundState;
  captainPlayerId?: string | null;
  crewPlayerId?: string | null;
  captainName?: string | null;
  crewName?: string | null;
  captainTranscript?: TranscriptResult;
  crewTranscript?: TranscriptResult;
  captainVerifiedTranscript?: TranscriptResult;
  crewVerifiedTranscript?: TranscriptResult;
  ohmResult?: OhmResult;
  metrics?: RoundMetrics;
  evaluation?: MeaningEvaluation;
  reactionDelayMs?: number;
  timeoutLost: boolean;
  captainAudioUrl?: string;
  crewAudioUrl?: string;
  captainAudioPath?: string;
  crewAudioPath?: string;
  captainAudioMimeType?: string;
  crewAudioMimeType?: string;
}

export interface SummaryLocationState {
  evaluation: MeaningEvaluation | null;
  reactionDelayMs: number | null;
  errorMessage?: string | null;
  captainPlayerId?: string | null;
  crewPlayerId?: string | null;
  captainName?: string | null;
  crewName?: string | null;
  captainTranscript?: TranscriptResult | null;
  crewTranscript?: TranscriptResult | null;
  captainVerifiedTranscript?: TranscriptResult | null;
  crewVerifiedTranscript?: TranscriptResult | null;
  ohmResult?: OhmResult | null;
  metrics?: RoundMetrics | null;
  captainAudioBlob?: Blob | null;
  crewAudioBlob?: Blob | null;
  captainAudioUrl?: string | null;
  crewAudioUrl?: string | null;
}

export type RoomStatus = 'waiting' | 'playing' | 'finished';
export type RoomRoundStatus = 'captain_speaking' | 'crew_speaking' | 'evaluating' | 'finished';

export interface RoomDoc {
  hostId: string;
  // Active 1v1 slot (resolves from team roster if team mode enabled)
  captainId?: string | null;
  crewId?: string | null;
  captainName?: string | null;
  crewName?: string | null;
  captainScore?: number;
  crewScore?: number;
  joinCode?: string;
  status: RoomStatus;
  createdAt: any;
  updatedAt: any;
  // Team faceoff fields (optional — present when teamMode is active)
  teamMode?: boolean;
  teamA?: string[];           // player UIDs for Team A (Captain team)
  teamB?: string[];           // player UIDs for Team B (Crew team)
  teamANames?: string[];
  teamBNames?: string[];
  teamAIndex?: number;        // current active player index in teamA
  teamBIndex?: number;        // current active player index in teamB
  swapAfterRound?: boolean;   // if true, teams swap roles each round
}

export interface RoomRoundDoc {
  roomId: string;
  roundNumber: number;
  status: RoomRoundStatus;
  createdAt: any;
  captainStoppedAtMs?: number;
  crewStartedAtMs?: number;
  crewDeadlineAtMs?: number;
  winnerRole?: 'captain' | 'crew' | 'none';
  endReason?: 'meaning' | 'crew_timeout' | 'manual' | 'cvr_out_of_range' | 'perfect_crew';
  captainPlayerId?: string | null;
  crewPlayerId?: string | null;
  captainTranscript?: string;
  crewTranscript?: string;
  captainTranscriptMeta?: TranscriptResult;
  crewTranscriptMeta?: TranscriptResult;
  captainAudioPath?: string;
  crewAudioPath?: string;
  captainAudioMimeType?: string;
  crewAudioMimeType?: string;
  meaningScore?: number;
  feedback?: string;
  meaningAnalysis?: MeaningEvaluation;
  ohmResult?: OhmResult | null;
  metrics?: RoundMetrics | null;
  reactionDelayMs?: number;
}
