const { normalizeOhmText } = require('./core');

const DEFAULT_CVR_MEASURE_BASE_URL = 'https://chunks-cvr-api-781691010426.asia-southeast1.run.app';
const DEFAULT_CVR_MEASURE_API_KEY = 'm2m_CHUNK_ANALYZER_SECURE_2026';
const DEFAULT_CVR_MEASURE_TIMEOUT_MS = 45000;

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeCvrColorLabel(value = '') {
  const color = String(value || '').trim().toLowerCase();
  if (color === 'green') return 'GREEN';
  if (color === 'blue') return 'BLUE';
  if (color === 'red') return 'RED';
  if (color === 'pink') return 'PINK';
  return 'NONE';
}

function normalizeCvrLengthBand(value = '') {
  const band = String(value || '').trim().toLowerCase();
  if (band === 'very short') return 'veryShort';
  if (band === 'short') return 'short';
  if (band === 'medium') return 'medium';
  if (band === 'long') return 'long';
  return 'overLong';
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildMatchedChunk(resource = {}) {
  const label = normalizeCvrColorLabel(resource.color);
  return {
    text: String(resource.text || resource.name || '').trim(),
    label,
    ohm: toFiniteNumber(resource.ohm, 0),
    confidence: 1,
    reason: 'matched resource from CVR library',
  };
}

function buildCandidateChunk(resource = {}) {
  const label = normalizeCvrColorLabel(resource.color);
  return {
    text: String(resource.text || resource.name || '').trim(),
    label,
    ohm: toFiniteNumber(resource.ohm, 0),
    confidence: clamp01(toFiniteNumber(resource.confidence, 0)),
    reason: String(resource.reasoning || 'candidate resource from CVR AI').trim(),
  };
}

function buildChunkDiagnostic(chunk, source, raw) {
  const confidence = toFiniteNumber(chunk.confidence, source === 'matched-resource' ? 1 : 0);
  const needsReview = source === 'candidate-resource' && confidence < 0.78;
  return {
    text: chunk.text,
    normalized: normalizeOhmText(chunk.text),
    source,
    inputLabel: chunk.label,
    verifierDecision: 'accepted',
    verifierReason: source === 'matched-resource' ? 'cvr-library-match' : 'cvr-ai-candidate',
    finalLabel: chunk.label,
    evidenceScore: confidence,
    verifierScore: confidence,
    needsReview,
    topCandidates: [],
    evidence: raw,
  };
}

async function callCvrMeasure({
  baseUrl,
  apiKey,
  transcript,
  resources,
  tcCorrections,
  settings,
  timeoutMs = DEFAULT_CVR_MEASURE_TIMEOUT_MS,
}) {
  const cleanBaseUrl = String(baseUrl || DEFAULT_CVR_MEASURE_BASE_URL).trim().replace(/\/$/, '');
  const effectiveApiKey = String(apiKey || process.env.CVR_MEASURE_API_KEY || DEFAULT_CVR_MEASURE_API_KEY).trim();
  if (!cleanBaseUrl) throw new Error('CVR Measure base URL not configured');
  if (!effectiveApiKey) throw new Error('CVR Measure API key not configured');

  const payload = {
    transcript,
    ...(Array.isArray(resources) && resources.length > 0 ? { resources } : {}),
    ...(Array.isArray(tcCorrections) && tcCorrections.length > 0 ? { tcCorrections } : {}),
    ...(settings && typeof settings === 'object' ? { settings } : {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(3000, Number(timeoutMs) || DEFAULT_CVR_MEASURE_TIMEOUT_MS));

  try {
    const response = await fetch(`${cleanBaseUrl}/api/measure-cvr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': effectiveApiKey,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = String(data?.error || data?.message || `CVR Measure error (${response.status})`).trim();
      throw new Error(message || 'CVR Measure request failed');
    }
    if (!data || typeof data !== 'object') {
      throw new Error('CVR Measure returned invalid JSON');
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('CVR Measure request timeout');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function mapCvrMeasureResponseToOhmPayload(result = {}, { elapsedMs = 0 } = {}) {
  const data = result?.data && typeof result.data === 'object' ? result.data : result;
  const transcriptRaw = String(data?.transcriptRaw || '').trim();
  const transcriptNormalized = String(data?.transcriptNormalized || normalizeOhmText(transcriptRaw));
  const lcBreakdown = data?.lcBreakdown && typeof data.lcBreakdown === 'object' ? data.lcBreakdown : {};
  const tcBreakdown = data?.tcBreakdown && typeof data.tcBreakdown === 'object' ? data.tcBreakdown : {};
  const tlBreakdown = data?.tlBreakdown && typeof data.tlBreakdown === 'object' ? data.tlBreakdown : {};

  const matchedResources = Array.isArray(tcBreakdown.matchedResources) ? tcBreakdown.matchedResources : [];
  const candidateResources = Array.isArray(tcBreakdown.candidateResources) ? tcBreakdown.candidateResources : [];

  const matchedChunks = matchedResources
    .map((resource) => ({ chunk: buildMatchedChunk(resource), raw: resource }))
    .filter(({ chunk }) => chunk.text && chunk.label !== 'NONE');

  const candidateChunks = candidateResources
    .map((resource) => ({ chunk: buildCandidateChunk(resource), raw: resource }))
    .filter(({ chunk }) => chunk.text && chunk.label !== 'NONE');

  const chunks = [...matchedChunks.map((entry) => entry.chunk), ...candidateChunks.map((entry) => entry.chunk)];

  const chunkDiagnostics = [
    ...matchedChunks.map(({ chunk, raw }) => buildChunkDiagnostic(chunk, 'matched-resource', raw)),
    ...candidateChunks.map(({ chunk, raw }) => buildChunkDiagnostic(chunk, 'candidate-resource', raw)),
  ];

  const baseOhm = toFiniteNumber(tcBreakdown.estimatedTC, toFiniteNumber(tcBreakdown.confirmedTC, 0));
  const lengthCoefficient = toFiniteNumber(lcBreakdown.lcValue, 1);
  const tlValue = toFiniteNumber(tlBreakdown.tlValue, 1);
  const predictedCVR = toFiniteNumber(data?.predictedCVR, Number((baseOhm * lengthCoefficient * tlValue).toFixed(4)));
  const uncertainChunkCount = candidateChunks.filter(({ chunk }) => toFiniteNumber(chunk.confidence, 0) < 0.78).length;

  return {
    transcriptRaw,
    transcriptNormalized,
    chunks,
    formula: String(data?.calculationString || data?.formula || 'Estimated TC * LC * TL'),
    totalOhm: predictedCVR,
    modelUsed: 'cvr-measure-api',
    analysisSource: 'cvr-measure',
    responseCoefficient: 1,
    responseCoefficientApplied: false,
    agentDiagnostics: {
      provider: 'cvr-measure',
      status: String(result?.status || 'success'),
      lcBreakdown,
      tcBreakdown,
      tlBreakdown,
      elapsedMs,
    },
    baseOhm,
    lengthBucket: normalizeCvrLengthBand(lcBreakdown.lengthBand),
    lengthCoefficient,
    verifierAppliedCount: 0,
    uncertainChunkCount,
    chunkDiagnostics,
    filteredChunkCount: 0,
    lexiconChunkCount: matchedChunks.length,
    compositeChunkCount: 0,
    conflictResolvedCount: 0,
    fallbackApplied: false,
    sentenceCount: toFiniteNumber(lcBreakdown.sentenceCount, 0),
    wordCount: toFiniteNumber(lcBreakdown.wordCount, 0),
    topicLevel: tlValue,
  };
}

module.exports = {
  DEFAULT_CVR_MEASURE_BASE_URL,
  DEFAULT_CVR_MEASURE_API_KEY,
  DEFAULT_CVR_MEASURE_TIMEOUT_MS,
  normalizeCvrColorLabel,
  normalizeCvrLengthBand,
  callCvrMeasure,
  mapCvrMeasureResponseToOhmPayload,
};
