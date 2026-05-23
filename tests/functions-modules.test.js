const { GOOGLE_STT_MODELS, defaultSharedConfig } = require('../firebase/ai-functions/src/config/sharedConfig');
const {
  applyCors,
  handleOptions,
  createThirdPartyAuthHeaders,
  toBoolean,
  toFiniteNumber,
  parseDurationSeconds,
} = require('../firebase/ai-functions/src/utils/http');
const {
  normalizeGoogleModelList,
  sanitizeSpeechModel,
  resolveSpeechLocation,
} = require('../firebase/ai-functions/src/transcript/googleSpeech');
const { extractFirstJsonObject } = require('../firebase/ai-functions/src/meaning/json');
const {
  normalizeOhmSettings,
  resolveLengthBucket,
  computeOhmFromChunks,
  normalizeOhmText,
} = require('../firebase/ai-functions/src/ohm/core');
const {
  normalizeCvrColorLabel,
  normalizeCvrLengthBand,
  mapCvrMeasureResponseToOhmPayload,
} = require('../firebase/ai-functions/src/ohm/cvrMeasureClient');

describe('functions helper modules', () => {
  test('exports canonical shared config defaults and Google STT model catalog', () => {
    expect(defaultSharedConfig.transcriptProvider).toBe('deepgram');
    expect(defaultSharedConfig.ohmAnalysisProvider).toBe('cvr-measure');
    expect(defaultSharedConfig.ohmWeights).toEqual({ GREEN: 5, BLUE: 7, RED: 9, PINK: 3 });
    expect(GOOGLE_STT_MODELS.map((model) => model.id)).toEqual(['chirp_3', 'chirp_2', 'telephony']);
  });

  test('http helpers apply cors and normalize header/auth/boolean/number parsing', () => {
    const headers = {};
    const res = {
      statusCode: 0,
      payload: '',
      set(key, value) {
        headers[key] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      send(payload) {
        this.payload = payload;
        return this;
      },
    };

    applyCors(res);
    expect(headers['Access-Control-Allow-Origin']).toBe('*');
    expect(createThirdPartyAuthHeaders('x-api-key', 'secret')).toEqual({ 'x-api-key': 'secret' });
    expect(createThirdPartyAuthHeaders('bearer', 'secret')).toEqual({ Authorization: 'Bearer secret' });
    expect(toBoolean('yes')).toBe(true);
    expect(toBoolean('off', true)).toBe(false);
    expect(toFiniteNumber('12.5', 0)).toBe(12.5);
    expect(parseDurationSeconds('3.75s')).toBe(3.75);

    const handled = handleOptions({ method: 'OPTIONS' }, res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(204);
  });

  test('transcript helpers sanitize models and resolve location fallbacks', () => {
    expect(normalizeGoogleModelList('chirp_3, telephony')).toEqual(['chirp_3', 'telephony']);
    expect(normalizeGoogleModelList('')).toEqual(['chirp_3', 'chirp_2', 'telephony']);
    expect(sanitizeSpeechModel('models/chirp_3...')).toBe('chirp_3');
    expect(resolveSpeechLocation('chirp_3', 'global')).toBe('us');
    expect(resolveSpeechLocation('telephony', 'global')).toBe('global');
  });

  test('meaning helper extracts first JSON object from fenced model output', () => {
    expect(extractFirstJsonObject('```json\n{"score":88}\n```')).toBe('{"score":88}');
    expect(() => extractFirstJsonObject('no json here')).toThrow('AI response did not contain a JSON object');
  });

  test('ohm helpers normalize settings, bucket transcript length, compute formulas, and normalize text', () => {
    const normalized = normalizeOhmSettings({
      ohmWeights: { GREEN: 4 },
      ohmLengthConstraints: { short: { maxSentences: 9, maxWords: 99 } },
      ohmLengthCoefficients: { overLong: 3.5 },
    });

    expect(normalized.weights).toEqual({ GREEN: 4, BLUE: 7, RED: 9, PINK: 3 });
    expect(normalized.constraints.short).toEqual({ maxSentences: 9, maxWords: 99 });
    expect(normalized.coefficients.overLong).toBe(3.5);
    expect(resolveLengthBucket('One short sentence.', normalized.constraints).lengthBucket).toBe('veryShort');
    expect(computeOhmFromChunks([{ label: 'GREEN' }, { label: 'RED' }], normalized.weights)).toEqual({
      baseOhm: 13,
      formula: '(4 + 9)',
    });
    expect(normalizeOhmText('“Piece of Cake!”')).toBe('piece of cake');
  });

  test('CVR Measure helper normalizes colors, bands, and maps API response into OHM payload shape', () => {
    expect(normalizeCvrColorLabel('Pink')).toBe('PINK');
    expect(normalizeCvrLengthBand('Very Short')).toBe('veryShort');

    const payload = mapCvrMeasureResponseToOhmPayload({
      status: 'success',
      data: {
        transcriptRaw: 'Thành thật mà nói, hạ đường huyết không phải chuyện nhỏ.',
        transcriptNormalized: 'thành thật mà nói hạ đường huyết không phải chuyện nhỏ',
        predictedCVR: 10,
        calculationString: '8 (TC) × 1 (LC) × 1.2 (TL) = 10',
        lcBreakdown: {
          sentenceCount: 1,
          wordCount: 10,
          lengthBand: 'Very Short',
          lcValue: 1,
        },
        tcBreakdown: {
          matchedResources: [
            { text: 'thành thật mà nói', color: 'Green', ohm: 5, matchStart: 0, matchEnd: 17, specificity: 4.0 },
          ],
          candidateResources: [
            { text: 'hạ đường huyết', color: 'Pink', ohm: 3, confidence: 0.9, reasoning: 'technical term' },
          ],
          confirmedTC: 5,
          estimatedTC: 8,
        },
        tlBreakdown: {
          band: 'TL 1.0-1.2 Daily life / casual routine',
          tlValue: 1.2,
          confidence: 0.9,
        },
      },
    }, { elapsedMs: 123 });

    expect(payload.totalOhm).toBe(10);
    expect(payload.baseOhm).toBe(8);
    expect(payload.lengthBucket).toBe('veryShort');
    expect(payload.lengthCoefficient).toBe(1);
    expect(payload.analysisSource).toBe('cvr-measure');
    expect(payload.chunks).toEqual([
      { text: 'thành thật mà nói', label: 'GREEN', ohm: 5, confidence: 1, reason: 'matched resource from CVR library' },
      { text: 'hạ đường huyết', label: 'PINK', ohm: 3, confidence: 0.9, reason: 'technical term' },
    ]);
    expect(payload.agentDiagnostics.provider).toBe('cvr-measure');
    expect(payload.chunkDiagnostics).toHaveLength(2);
  });
});
