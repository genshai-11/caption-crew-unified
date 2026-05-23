const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const nuanceLexicon = require('./nuanceLexicon.json');
const { GOOGLE_STT_MODELS, defaultSharedConfig } = require('./config/sharedConfig');
const {
  applyCors,
  handleOptions,
  createThirdPartyAuthHeaders,
  toBoolean,
  toFiniteNumber,
  parseDurationSeconds,
} = require('./utils/http');
const {
  normalizeGoogleModelList,
  sanitizeSpeechModel,
  resolveSpeechLocation,
} = require('./transcript/googleSpeech');
const { extractFirstJsonObject } = require('./meaning/json');
const {
  normalizeOhmSettings,
  resolveLengthBucket,
  computeOhmFromChunks,
  normalizeOhmText,
} = require('./ohm/core');
const {
  callCvrMeasure,
  mapCvrMeasureResponseToOhmPayload,
} = require('./ohm/cvrMeasureClient');
const {
  createGetDeepgramAccessTokenHandler,
  createTranscribeRoundAudioHandler,
} = require('./handlers/transcriptHandlers');
const { createAnalyzeTranscriptOhmHandler } = require('./handlers/ohmHandlers');
const {
  createFetchGoogleSttModelsHandler,
  createTestGoogleSttModelsHandler,
  createFetchRouterModelsHandler,
  createTestRouterCompletionHandler,
} = require('./handlers/modelHandlers');
const { createEvaluateCaptionCrewMeaningHandler } = require('./handlers/meaningHandlers');

if (!admin.apps.length) {
  admin.initializeApp();
}

async function getSharedAdminConfig() {
  try {
    const [buffer] = await admin.storage().bucket().file('admin-runtime/shared.json').download();
    const parsed = JSON.parse(buffer.toString('utf-8'));
    return { ...defaultSharedConfig, ...(parsed || {}) };
  } catch (error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    if (code === '404' || message.includes('No such object')) {
      return defaultSharedConfig;
    }
    logger.warn('Could not load shared admin config from Storage', error);
    return defaultSharedConfig;
  }
}

async function callDeepgramListen({ apiKey, model, language, contentType, audioBuffer, detectLanguage = false }) {
  const deepgramUrl = `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(model)}&smart_format=true&punctuate=true&utterances=true&detect_language=${detectLanguage ? 'true' : 'false'}${language ? `&language=${encodeURIComponent(language)}` : ''}`;
  const response = await fetch(deepgramUrl, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': contentType,
    },
    body: audioBuffer,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Deepgram error (${response.status}): ${text}`);
  }

  return await response.json();
}

async function getGcpAccessToken() {
  const metadataUrl = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
  const response = await fetch(metadataUrl, {
    method: 'GET',
    headers: {
      'Metadata-Flavor': 'Google',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Could not obtain GCP access token (${response.status}): ${body}`);
  }

  const payload = await response.json();
  const accessToken = String(payload?.access_token || '');
  if (!accessToken) throw new Error('GCP access token was empty');
  return accessToken;
}

async function callGoogleSpeechTranscribe({ model, language, location, projectId, contentType, audioBuffer }) {
  const cleanModel = sanitizeSpeechModel(model);
  const selectedLocation = resolveSpeechLocation(cleanModel, location);
  const selectedProjectId = String(
    projectId
    || process.env.GCLOUD_PROJECT
    || process.env.GOOGLE_CLOUD_PROJECT
    || process.env.PROJECT_ID
    || ''
  );

  if (!selectedProjectId) {
    throw new Error('Google STT project ID is missing. Set googleCloudProjectId in Admin config or GOOGLE_CLOUD_PROJECT env.');
  }

  const languageCode = language === 'vi' ? 'vi-VN' : language === 'en' ? 'en-US' : 'en-US';
  const base64Audio = Buffer.from(audioBuffer).toString('base64');

  const accessToken = await getGcpAccessToken();

  const speechHost = selectedLocation === 'global'
    ? 'speech.googleapis.com'
    : `${selectedLocation}-speech.googleapis.com`;

  const response = await fetch(
    `https://${speechHost}/v2/projects/${encodeURIComponent(selectedProjectId)}/locations/${encodeURIComponent(selectedLocation)}/recognizers/_:recognize`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        config: {
          autoDecodingConfig: {},
          languageCodes: [languageCode],
          model: cleanModel,
          features: {
            enableAutomaticPunctuation: true,
          },
        },
        content: base64Audio,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Speech transcript error (${response.status}): ${body}`);
  }

  const result = await response.json();
  const alternatives = result?.results?.flatMap((entry) => entry?.alternatives || []) || [];
  const transcript = String(alternatives.map((alt) => alt?.transcript || '').join(' ').replace(/\s+/g, ' ').trim());
  const confidenceValues = alternatives
    .map((alt) => Number(alt?.confidence || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  const confidence = confidenceValues.length > 0
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : (transcript ? 1 : 0);

  return {
    transcript,
    confidence,
    duration: parseDurationSeconds(result?.metadata?.totalBilledDuration),
    metadata: {
      model: cleanModel,
      requestId: String(result?.metadata?.requestId || result?.metadata?.request_id || ''),
      projectId: selectedProjectId,
      location: selectedLocation,
      mimeType: contentType,
    },
  };
}

async function callOhmAgent({ endpoint, apiKey, authScheme = 'bearer', payload, timeoutMs = 9000 }) {
  const cleanEndpoint = String(endpoint || '').trim();
  if (!cleanEndpoint) throw new Error('OHM agent endpoint not configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1500, Number(timeoutMs) || 9000));

  try {
    const response = await fetch(cleanEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...createThirdPartyAuthHeaders(authScheme, apiKey),
      },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OHM agent error (${response.status}): ${text}`);
    }

    const data = await response.json();
    if (!data || typeof data !== 'object') {
      throw new Error('OHM agent returned invalid JSON');
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('OHM agent request timeout');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callThirdPartyTranscript({ url, apiKey, authScheme, contentType, audioBuffer }) {
  if (!url) throw new Error('THIRD_PARTY_TRANSCRIPT_URL not configured');
  const payload = {
    audioData: Buffer.from(audioBuffer).toString('base64'),
    mimeType: contentType,
  };

  const response = await fetch(String(url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...createThirdPartyAuthHeaders(authScheme, apiKey),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error('Third-party transcript error (' + response.status + '): ' + body);
  }

  const result = await response.json();
  return {
    transcript: String(result?.transcript || result?.text || '').trim(),
    confidence: Number(result?.confidence || 0),
    duration: Number(result?.duration || 0),
    modelUsed: String(result?.modelUsed || result?.model || ''),
    requestId: String(result?.requestId || result?.id || ''),
  };
}

async function callThirdPartyOhm({ url, apiKey, authScheme, model, transcript, webhookUrl }) {
  if (!url) throw new Error('THIRD_PARTY_OHM_URL not configured');

  const response = await fetch(String(url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...createThirdPartyAuthHeaders(authScheme, apiKey),
    },
    body: JSON.stringify({
      transcript,
      settings: {
        ohmBaseValues: { Green: 5, Blue: 7, Red: 9, Pink: 3 },
      },
      webhookUrl: webhookUrl || undefined,
      model: model || undefined,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error('Third-party Ohm error (' + response.status + '): ' + body);
  }

  const result = await response.json();
  return {
    transcriptRaw: String(result?.transcriptRaw || transcript),
    transcriptNormalized: String(result?.transcriptNormalized || ''),
    chunks: Array.isArray(result?.chunks) ? result.chunks : [],
    formula: String(result?.formula || '0'),
    totalOhm: Number(result?.totalOhm || 0),
    modelUsed: String(result?.modelUsed || result?.model || model || ''),
  };
}

function normalizeDeepgramResult(result, meta = {}) {
  const alternative = result?.results?.channels?.[0]?.alternatives?.[0] || {};
  return {
    transcript: alternative.transcript || '',
    words: alternative.words || [],
    confidence: alternative.confidence || 0,
    duration: result?.metadata?.duration || 0,
    requestId: result?.metadata?.request_id || '',
    ...meta,
  };
}

exports.getDeepgramAccessToken = createGetDeepgramAccessTokenHandler({
  onRequest,
  handleOptions,
  applyCors,
  getSharedAdminConfig,
  fetch,
  logger,
});

exports.transcribeRoundAudio = createTranscribeRoundAudioHandler({
  onRequest,
  handleOptions,
  applyCors,
  getSharedAdminConfig,
  callThirdPartyTranscript,
  callGoogleSpeechTranscribe,
  callDeepgramListen,
  normalizeDeepgramResult,
  logger,
});

exports.analyzeTranscriptOhm = createAnalyzeTranscriptOhmHandler({
  onRequest,
  admin,
  logger,
  nuanceLexicon,
  applyCors,
  handleOptions,
  getSharedAdminConfig,
  toBoolean,
  toFiniteNumber,
  callOhmAgent,
  extractFirstJsonObject,
  normalizeOhmSettings,
  resolveLengthBucket,
  computeOhmFromChunks,
  normalizeOhmText,
  callRouterChat,
  callCvrMeasure,
  mapCvrMeasureResponseToOhmPayload,
});

async function callRouterChat({ apiKey, baseUrl, model, fallbackModel, messages, temperature = 0.2, responseFormat, timeoutMs = 20000 }) {
  const cleanApiKey = String(apiKey || '').trim();
  const cleanBaseUrl = String(baseUrl || '').trim();
  if (!cleanApiKey) throw new Error('ROUTER9_API_KEY not configured');
  if (!model && !fallbackModel) throw new Error('No Router9 model configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(3000, Number(timeoutMs) || 12000));

  try {
    const response = await fetch(`${cleanBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cleanApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || fallbackModel,
        temperature,
        stream: false,
        ...(responseFormat ? { response_format: responseFormat } : {}),
        messages,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Router9 error (${response.status}): ${text}`);
    }

    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Router9 request timeout');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

exports.fetchGoogleSttModels = createFetchGoogleSttModelsHandler({
  onRequest,
  handleOptions,
  applyCors,
  getSharedAdminConfig,
  GOOGLE_STT_MODELS,
  logger,
});

exports.testGoogleSttModels = createTestGoogleSttModelsHandler({
  onRequest,
  handleOptions,
  applyCors,
  getSharedAdminConfig,
  normalizeGoogleModelList,
  callGoogleSpeechTranscribe,
  logger,
});

exports.fetchRouterModels = createFetchRouterModelsHandler({
  onRequest,
  handleOptions,
  applyCors,
  getSharedAdminConfig,
  fetch,
  logger,
});

exports.testRouterCompletion = createTestRouterCompletionHandler({
  onRequest,
  handleOptions,
  applyCors,
  getSharedAdminConfig,
  callRouterChat,
  logger,
});

exports.evaluateCaptionCrewMeaning = createEvaluateCaptionCrewMeaningHandler({
  onRequest,
  handleOptions,
  applyCors,
  getSharedAdminConfig,
  callRouterChat,
  logger,
});
