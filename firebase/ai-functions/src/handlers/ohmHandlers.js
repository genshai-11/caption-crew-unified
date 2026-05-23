function createAnalyzeTranscriptOhmHandler(deps) {
  const {
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
  } = deps;

const OHM_NOISE_TERMS = new Set(['liệu', 'à', 'ạ', 'ơi', 'ơ', 'hả', 'nhé', 'nha', 'nhỉ', 'nhỉ?', 'ừ', 'ừm', 'ok', 'okay', 'đi', 'vớ']);
const OHM_LABEL_PRIORITY = { RED: 4, BLUE: 3, GREEN: 2, PINK: 1 };

function isLexiconEntryAcceptable(entry) {
  if (!entry || !entry.normalized) return false;
  if (!['GREEN', 'BLUE', 'RED', 'PINK'].includes(entry.label)) return false;
  if (entry.words < 2) return false;
  if (entry.normalized.length < 4) return false;
  if (OHM_NOISE_TERMS.has(entry.normalized)) return false;
  return true;
}

const nuanceLexiconIndex = (() => {
  if (!Array.isArray(nuanceLexicon)) return [];

  const dedup = new Map();
  for (const entry of nuanceLexicon) {
    const normalized = normalizeOhmText(entry?.normalized || entry?.text || '');
    const next = {
      label: String(entry?.label || '').toUpperCase(),
      text: String(entry?.text || '').trim(),
      normalized,
      words: normalized.split(/\s+/).filter(Boolean).length,
    };

    if (!isLexiconEntryAcceptable(next)) continue;

    const prev = dedup.get(next.normalized);
    if (!prev) {
      dedup.set(next.normalized, next);
      continue;
    }

    const prevPriority = OHM_LABEL_PRIORITY[prev.label] || 0;
    const nextPriority = OHM_LABEL_PRIORITY[next.label] || 0;
    if (nextPriority > prevPriority) {
      dedup.set(next.normalized, next);
    }
  }

  return Array.from(dedup.values()).sort((a, b) => b.normalized.length - a.normalized.length);
})();

const nuanceLexiconByNormalized = (() => {
  const map = new Map();
  for (const entry of nuanceLexiconIndex) {
    const key = String(entry?.normalized || '');
    if (!key) continue;
    const list = map.get(key) || [];
    list.push(entry);
    map.set(key, list);
  }
  return map;
})();

const OHM_EVIDENCE_WEIGHTS = {
  lexiconExact: 0.35,
  lexiconFuzzy: 0.2,
  functional: 0.25,
  context: 0.1,
  modelConfidence: 0.1,
};

const OHM_EVIDENCE_THRESHOLDS = {
  minEvidence: 0.42,
  verifierAccept: 0.62,
  uncertainMin: 0.48,
  uncertainMax: 0.78,
};

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function tokenizeNormalized(value = '') {
  return String(value || '').split(/\s+/).filter(Boolean);
}

function hasWordBoundaries(source = '', start = 0, end = 0) {
  const prev = source[start - 1];
  const next = source[end];
  const prevOk = !prev || prev === ' ';
  const nextOk = !next || next === ' ';
  return prevOk && nextOk;
}

function computeTokenOverlapScore(left = '', right = '') {
  const leftTokens = new Set(tokenizeNormalized(left));
  const rightTokens = new Set(tokenizeNormalized(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let shared = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) shared += 1;
  });

  const minSize = Math.min(leftTokens.size, rightTokens.size);
  if (minSize === 0) return 0;
  return shared / minSize;
}

function resolveLexiconExactEvidence(normalized = '', label = '') {
  const entries = nuanceLexiconByNormalized.get(normalized) || [];
  return entries.some((entry) => entry.label === label) ? 1 : 0;
}

function findBestFuzzyLexiconMatch(normalized = '', label = '') {
  const tokens = tokenizeNormalized(normalized);
  if (tokens.length < 2) return null;

  let best = null;
  for (const entry of nuanceLexiconIndex) {
    if (label && entry.label !== label) continue;

    const overlap = computeTokenOverlapScore(normalized, entry.normalized);
    if (overlap < 0.66) continue;

    const tokenGap = Math.abs(tokens.length - entry.words);
    if (tokenGap > 2) continue;

    const score = clamp01(overlap - tokenGap * 0.05);
    if (!best || score > best.score) {
      best = {
        label: entry.label,
        normalized: entry.normalized,
        text: entry.text,
        score,
      };
    }
  }

  return best;
}

function resolveContextSignal(label = '', normalized = '', transcript = '') {
  if (label === 'GREEN') return isSentenceOpener(normalized, transcript) ? 1 : 0;
  if (label === 'BLUE') return BLUE_FRAME_MARKERS.some((marker) => normalized.includes(marker)) ? 1 : 0;
  if (label === 'RED') return isRedIdiomCandidate(normalized) ? 1 : 0;
  if (label === 'PINK') return !PINK_COMMON_PHRASES.has(normalized) ? 1 : 0.2;
  return 0;
}

function scoreChunkEvidence({ label = '', normalized = '', transcript = '', modelConfidence = 0, sourceType = 'model' }) {
  const lexiconExact = resolveLexiconExactEvidence(normalized, label);
  const fuzzy = lexiconExact ? null : findBestFuzzyLexiconMatch(normalized, label);
  const lexiconFuzzy = fuzzy ? clamp01(fuzzy.score) : 0;
  const functional = isLabelChunkAcceptable(label, normalized, transcript, sourceType === 'lexicon' ? 'lexicon' : 'model') ? 1 : 0;
  const context = resolveContextSignal(label, normalized, transcript);
  const confidence = clamp01(Number(modelConfidence || 0));

  const score = clamp01(
    lexiconExact * OHM_EVIDENCE_WEIGHTS.lexiconExact
    + lexiconFuzzy * OHM_EVIDENCE_WEIGHTS.lexiconFuzzy
    + functional * OHM_EVIDENCE_WEIGHTS.functional
    + context * OHM_EVIDENCE_WEIGHTS.context
    + confidence * OHM_EVIDENCE_WEIGHTS.modelConfidence,
  );

  return {
    score,
    evidence: {
      lexiconExact,
      lexiconFuzzy: Number(lexiconFuzzy.toFixed(4)),
      functional,
      context,
      modelConfidence: Number(confidence.toFixed(4)),
      fuzzyLexiconLabel: fuzzy?.label || null,
      fuzzyLexiconText: fuzzy?.text || null,
    },
  };
}

function withChunkEvidence(chunk, transcript = '', sourceType = 'model') {
  const label = String(chunk?.label || '').toUpperCase();
  const normalized = normalizeOhmText(chunk?.text || '');
  const confidence = Number(chunk?.confidence || 0);
  const scored = scoreChunkEvidence({
    label,
    normalized,
    transcript,
    modelConfidence: confidence,
    sourceType,
  });

  return {
    ...chunk,
    label,
    normalized,
    source: sourceType,
    evidence: scored.evidence,
    evidenceScore: scored.score,
  };
}

function detectLexiconChunks(transcript = '', weights = { GREEN: 5, BLUE: 7, RED: 9, PINK: 3 }) {
  const source = normalizeOhmText(transcript);
  if (!source) return [];

  const occupied = [];
  const chunks = [];

  for (const entry of nuanceLexiconIndex) {
    let idx = source.indexOf(entry.normalized);
    while (idx >= 0) {
      const start = idx;
      const end = idx + entry.normalized.length;
      const overlaps = occupied.some((slot) => !(end <= slot.start || start >= slot.end));
      const bounded = hasWordBoundaries(source, start, end);

      if (!overlaps && bounded) {
        if (isLabelChunkAcceptable(entry.label, entry.normalized, transcript, 'lexicon')) {
          occupied.push({ start, end });
          const baseChunk = {
            text: entry.text,
            label: entry.label,
            ohm: Number(weights[entry.label] || 0),
            confidence: 0.995,
            reason: 'nuance lexicon exact match',
          };
          chunks.push(withChunkEvidence(baseChunk, transcript, 'lexicon'));
        }
      }
      idx = source.indexOf(entry.normalized, idx + entry.normalized.length);
    }
  }

  return chunks;
}

const PINK_COMMON_PHRASES = new Set(['ngày mai', 'hôm nay', 'bây giờ', 'đi với tôi', 'không tới', 'có đi', 'với tôi']);
const RED_IDIOM_MARKERS = [
  'gieo gió', 'gặt bão', 'đứng núi này trông núi nọ', 'vỏ quýt dày có móng tay nhọn', 'đâm sau lưng',
  'bút sa gà chết', 'xa mặt cách lòng', 'khách hàng là thượng đế', 'chuyện gì tới nó tới', 'đừng đùa với lửa',
  'bữa tiệc nào rồi cũng có lúc tàn', 'im lặng là đồng ý', 'có cái giá', 'đi guốc trong bụng',
  'gần mực thì đen gần đèn thì sáng', 'nói trước bước không qua', 'thời gian sẽ trả lời',
  'đứng núi này', 'trông núi nọ', 'bóp chết từ trong trứng nước', 'tiền nào của đó', 'yêu từ cái nhìn đầu tiên',
  'gừng càng già càng cay', 'mài sắt có ngày nên kim'
];
const RED_EXACT_SET = new Set([
  'gần mực thì đen gần đèn thì sáng',
  'gieo gió thì gặt bão',
  'đứng núi này trông núi nọ',
  'vỏ quýt dày có móng tay nhọn',
  'đâm sau lưng',
  'bút sa gà chết',
  'xa mặt cách lòng',
  'nói trước bước không qua',
  'thời gian sẽ trả lời',
  'bóp chết từ trong trứng nước',
  'tiền nào của đó',
  'khách hàng là thượng đế',
  'im lặng là đồng ý',
  'chuyện gì tới nó tới',
  'bữa tiệc nào rồi cũng có lúc tàn',
  'gừng càng già càng cay',
  'có công mài sắt có ngày nên kim',
  'mài sắt có ngày nên kim'
]);
const RED_COMPOSITE_IDIOMS = [
  'gần mực thì đen gần đèn thì sáng',
  'gieo gió thì gặt bão',
  'đứng núi này trông núi nọ',
  'vỏ quýt dày có móng tay nhọn',
  'bữa tiệc nào rồi cũng có lúc tàn',
  'gừng càng già càng cay',
  'có công mài sắt có ngày nên kim'
];
const BLUE_FRAME_MARKERS = [
  'cậu có', 'bạn có', 'điều gì làm', 'nếu cậu', 'nếu bạn', 'tui nghĩ', 'tôi nghĩ', 'hãy', 'đừng', 'làm sao', 'sao cậu', 'ai mà', 'một mặt', 'mặt khác'
];
const GREEN_OPENER_MARKERS = [
  'dù sao thì', 'tôi muốn nói là', 'tui muốn nói là', 'nói cách khác', 'từ bây giờ', 'dù gì', 'tóm lại', 'thực sự mà nói'
];

const BLUE_EXACT_SET = new Set(
  Array.isArray(nuanceLexicon)
    ? nuanceLexicon
        .filter((entry) => String(entry?.label || '').toUpperCase() === 'BLUE')
        .map((entry) => normalizeOhmText(entry?.normalized || entry?.text || ''))
        .filter(Boolean)
    : []
);

function isSentenceOpener(phraseNormalized = '', transcript = '') {
  if (!phraseNormalized) return false;
  const clauses = String(transcript || '')
    .split(/[.!?,;:\n\r]+/)
    .map((segment) => normalizeOhmText(segment))
    .filter(Boolean);
  if (clauses.some((clause) => clause.startsWith(phraseNormalized))) return true;
  return GREEN_OPENER_MARKERS.some((marker) => phraseNormalized.includes(marker));
}

function isRedIdiomCandidate(normalized = '') {
  if (!normalized) return false;
  if (RED_EXACT_SET.has(normalized)) return true;
  if (RED_IDIOM_MARKERS.some((marker) => normalized.includes(marker))) return true;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length >= 6 && normalized.includes(' thì ') && normalized.split(' thì ').length >= 3) return true;
  return false;
}

function coerceIdiomLabel(label = '', normalized = '') {
  const next = String(label || '').toUpperCase();
  if (isRedIdiomCandidate(normalized)) return 'RED';
  return next;
}

function isLabelChunkAcceptable(label = '', normalized = '', transcript = '', sourceType = 'model') {
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  if (OHM_NOISE_TERMS.has(normalized)) return false;

  if (label === 'GREEN') {
    return isSentenceOpener(normalized, transcript);
  }

  if (label === 'BLUE') {
    if (sourceType === 'lexicon') {
      return BLUE_EXACT_SET.has(normalized);
    }

    const blueByMarker = BLUE_FRAME_MARKERS.some((marker) => normalized.includes(marker));
    const blueByNegThinkFrame = normalized.startsWith('tôi không nghĩ') || normalized.startsWith('tui không nghĩ');
    const blueFuzzy = findBestFuzzyLexiconMatch(normalized, 'BLUE');

    return words.length >= 3 && (blueByMarker || blueByNegThinkFrame || Number(blueFuzzy?.score || 0) >= 0.72);
  }

  if (label === 'RED') {
    const redFuzzy = findBestFuzzyLexiconMatch(normalized, 'RED');
    return words.length >= 3 && (isRedIdiomCandidate(normalized) || Number(redFuzzy?.score || 0) >= 0.72);
  }

  if (label === 'PINK') {
    if (sourceType === 'lexicon') {
      return words.length >= 2 && !PINK_COMMON_PHRASES.has(normalized);
    }
    const pinkFuzzy = findBestFuzzyLexiconMatch(normalized, 'PINK');
    return !PINK_COMMON_PHRASES.has(normalized) && (words.length >= 3 || Number(pinkFuzzy?.score || 0) >= 0.72);
  }

  return false;
}

function sanitizeOhmChunks(chunks = [], transcript = '') {
  const source = normalizeOhmText(transcript);

  return chunks
    .map((chunk) => {
      const text = String(chunk?.text || '').trim();
      if (!text) return null;

      const normalized = normalizeOhmText(text);
      const label = String(chunk?.label || '').toUpperCase();
      const idx = source.indexOf(normalized);
      if (idx < 0) return null;
      if (!hasWordBoundaries(source, idx, idx + normalized.length)) return null;
      if (!isLabelChunkAcceptable(label, normalized, transcript, 'model')) return null;

      const enriched = withChunkEvidence({ ...chunk, text, label }, transcript, 'model');
      if (enriched.evidenceScore < OHM_EVIDENCE_THRESHOLDS.minEvidence) return null;
      return enriched;
    })
    .filter(Boolean);
}

function detectCompositeIdiomChunks(transcript = '', weights = { GREEN: 5, BLUE: 7, RED: 9, PINK: 3 }) {
  const source = normalizeOhmText(transcript);
  const chunks = [];
  for (const idiom of RED_COMPOSITE_IDIOMS) {
    const normalized = normalizeOhmText(idiom);
    if (!normalized || !source.includes(normalized)) continue;
    const idx = source.indexOf(normalized);
    if (!hasWordBoundaries(source, idx, idx + normalized.length)) continue;

    const baseChunk = {
      text: idiom,
      label: 'RED',
      ohm: Number(weights.RED || 9),
      confidence: 0.999,
      reason: 'composite idiom exact match',
    };
    chunks.push(withChunkEvidence(baseChunk, transcript, 'composite'));
  }
  return chunks;
}

function compareChunkStrength(next, prev) {
  const sourcePriority = { composite: 4, lexicon: 3, model: 2 };
  const nextSource = sourcePriority[String(next?.source || 'model')] || 1;
  const prevSource = sourcePriority[String(prev?.source || 'model')] || 1;
  if (nextSource !== prevSource) return nextSource - prevSource;

  const nextScore = Number(next?.evidenceScore || 0);
  const prevScore = Number(prev?.evidenceScore || 0);
  if (nextScore !== prevScore) return nextScore - prevScore;

  const nextLabelPriority = OHM_LABEL_PRIORITY[String(next?.label || '').toUpperCase()] || 0;
  const prevLabelPriority = OHM_LABEL_PRIORITY[String(prev?.label || '').toUpperCase()] || 0;
  return nextLabelPriority - prevLabelPriority;
}

function mergeLexiconAndModelChunks(compositeChunks = [], lexiconChunks = [], modelChunks = [], transcript = '') {
  const map = new Map();

  const upsert = (chunk) => {
    if (!chunk) return;
    const normalized = String(chunk.normalized || normalizeOhmText(chunk.text || '')).trim();
    if (!normalized) return;

    const label = String(chunk.label || '').toUpperCase();
    const source = String(chunk.source || 'model');
    const sourceType = source === 'lexicon' ? 'lexicon' : 'model';
    if (!isLabelChunkAcceptable(label, normalized, transcript, sourceType)) return;

    const key = `${label}::${normalized}`;
    const next = {
      ...chunk,
      label,
      normalized,
      source,
      evidenceScore: Number(chunk?.evidenceScore || 0),
    };

    const prev = map.get(key);
    if (!prev || compareChunkStrength(next, prev) > 0) {
      map.set(key, next);
    }
  };

  compositeChunks.forEach(upsert);
  lexiconChunks.forEach(upsert);
  modelChunks.forEach(upsert);

  const items = Array.from(map.values());
  const compositeNorms = compositeChunks.map((c) => String(c.normalized || normalizeOhmText(c.text || '')));
  if (compositeNorms.length === 0) return items;

  return items.filter((chunk) => {
    const normalized = String(chunk.normalized || normalizeOhmText(chunk.text || ''));
    const isComposite = compositeNorms.includes(normalized);
    if (isComposite) return true;
    if (String(chunk.label || '').toUpperCase() !== 'RED') return true;
    return !compositeNorms.some((comp) => comp.includes(normalized));
  });
}

function verifyChunkCandidate(chunk = {}, transcript = '') {
  const normalized = String(chunk.normalized || normalizeOhmText(chunk.text || '')).trim();
  const currentLabel = String(chunk.label || '').toUpperCase();
  const modelConfidence = clamp01(Number(chunk.confidence || 0));

  const labels = ['RED', 'BLUE', 'GREEN', 'PINK'];
  const scored = labels
    .map((label) => {
      const { score, evidence } = scoreChunkEvidence({
        label,
        normalized,
        transcript,
        modelConfidence,
        sourceType: 'model',
      });

      const boostedScore = label === 'RED' && isRedIdiomCandidate(normalized)
        ? Math.max(score, 0.92)
        : score;

      return {
        label,
        score: Number(boostedScore.toFixed(4)),
        evidence,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (OHM_LABEL_PRIORITY[b.label] || 0) - (OHM_LABEL_PRIORITY[a.label] || 0);
    });

  const best = scored[0];
  const current = scored.find((item) => item.label === currentLabel) || { score: 0, evidence: null };

  if (!best || best.score < OHM_EVIDENCE_THRESHOLDS.minEvidence) {
    return {
      decision: 'reject',
      finalLabel: currentLabel,
      finalScore: Number(current.score || 0),
      needsReview: true,
      reason: 'insufficient evidence',
      topCandidates: scored.slice(0, 2),
    };
  }

  const margin = Number((best.score - Number(current.score || 0)).toFixed(4));
  const uncertainBand = best.score >= OHM_EVIDENCE_THRESHOLDS.uncertainMin && best.score <= OHM_EVIDENCE_THRESHOLDS.uncertainMax;
  const disagreement = best.label !== currentLabel;
  const needsReview = uncertainBand || (disagreement && margin < 0.2);

  if (best.label !== currentLabel && best.score >= OHM_EVIDENCE_THRESHOLDS.verifierAccept) {
    return {
      decision: 'relabel',
      finalLabel: best.label,
      finalScore: best.score,
      needsReview,
      reason: `relabel ${currentLabel} → ${best.label}`,
      topCandidates: scored.slice(0, 2),
    };
  }

  return {
    decision: 'accept',
    finalLabel: currentLabel,
    finalScore: Number(current.score || best.score || 0),
    needsReview,
    reason: needsReview ? 'accepted with uncertainty' : 'accepted',
    topCandidates: scored.slice(0, 2),
  };
}

function applyChunkVerifier(candidates = [], transcript = '', weights = { GREEN: 5, BLUE: 7, RED: 9, PINK: 3 }) {
  const next = [];
  const diagnostics = [];
  let appliedCount = 0;

  for (const chunk of candidates) {
    const baselineScore = Number(chunk?.evidenceScore || 0);
    const shouldVerify = baselineScore <= OHM_EVIDENCE_THRESHOLDS.uncertainMax || String(chunk?.source || '') === 'model';

    if (!shouldVerify) {
      next.push({ ...chunk, needsReview: false, verifierDecision: 'skipped' });
      continue;
    }

    appliedCount += 1;
    const verification = verifyChunkCandidate(chunk, transcript);
    const normalized = String(chunk.normalized || normalizeOhmText(chunk.text || ''));

    diagnostics.push({
      text: String(chunk.text || ''),
      normalized,
      source: String(chunk.source || 'model'),
      inputLabel: String(chunk.label || '').toUpperCase(),
      verifierDecision: verification.decision,
      verifierReason: verification.reason,
      finalLabel: verification.finalLabel,
      evidenceScore: baselineScore,
      verifierScore: Number(verification.finalScore || 0),
      needsReview: verification.needsReview === true,
      topCandidates: verification.topCandidates,
      evidence: chunk.evidence || null,
    });

    if (verification.decision === 'reject') continue;

    const finalLabel = String(verification.finalLabel || chunk.label || '').toUpperCase();
    const finalChunk = {
      ...chunk,
      label: finalLabel,
      ohm: Number(weights[finalLabel] || chunk.ohm || 0),
      evidenceScore: Number(Math.max(baselineScore, verification.finalScore || 0).toFixed(4)),
      verifierDecision: verification.decision,
      needsReview: verification.needsReview === true,
      reason: verification.decision === 'relabel'
        ? `${String(chunk.reason || '').trim()} | verifier: ${verification.reason}`.trim()
        : chunk.reason,
    };

    next.push(finalChunk);
  }

  return {
    chunks: next,
    diagnostics,
    verifierAppliedCount: appliedCount,
    uncertainChunkCount: diagnostics.filter((entry) => entry.needsReview).length,
  };
}

function resolveChunkConflicts(chunks = [], transcript = '') {
  const source = normalizeOhmText(transcript);
  const sourcePriority = { composite: 4, lexicon: 3, model: 2, fallback: 1 };

  const sorted = Array.isArray(chunks)
    ? [...chunks].sort((a, b) => {
        const scoreDiff = Number(b?.evidenceScore || 0) - Number(a?.evidenceScore || 0);
        if (scoreDiff !== 0) return scoreDiff;

        const sourceDiff = (sourcePriority[String(b?.source || 'model')] || 0) - (sourcePriority[String(a?.source || 'model')] || 0);
        if (sourceDiff !== 0) return sourceDiff;

        return String(b?.normalized || b?.text || '').length - String(a?.normalized || a?.text || '').length;
      })
    : [];

  const resolved = [];
  const dropped = [];

  const shouldPreferFrameOverGreen = (left, right) => {
    const leftLabel = String(left?.label || '').toUpperCase();
    const rightLabel = String(right?.label || '').toUpperCase();

    if (leftLabel === 'GREEN' && (rightLabel === 'RED' || rightLabel === 'BLUE')) {
      return String(right?.normalized || '').includes(String(left?.normalized || ''));
    }
    if (rightLabel === 'GREEN' && (leftLabel === 'RED' || leftLabel === 'BLUE')) {
      return String(left?.normalized || '').includes(String(right?.normalized || ''));
    }
    return false;
  };

  for (const chunk of sorted) {
    const candidate = {
      ...chunk,
      normalized: String(chunk?.normalized || normalizeOhmText(chunk?.text || '')).trim(),
      label: String(chunk?.label || '').toUpperCase(),
    };

    if (!candidate.normalized) continue;

    let rejected = false;
    for (let i = 0; i < resolved.length; i += 1) {
      const existing = resolved[i];
      const sameKey = candidate.label === existing.label && candidate.normalized === existing.normalized;
      if (sameKey) {
        if (compareChunkStrength(candidate, existing) > 0) {
          dropped.push({ drop: existing, keep: candidate, reason: 'duplicate-replaced' });
          resolved[i] = candidate;
        } else {
          dropped.push({ drop: candidate, keep: existing, reason: 'duplicate-ignored' });
        }
        rejected = true;
        break;
      }

      const overlap = computeTokenOverlapScore(candidate.normalized, existing.normalized);
      const highOverlap = overlap >= 0.72;
      const containmentConflict = shouldPreferFrameOverGreen(candidate, existing);
      if (!highOverlap && !containmentConflict) continue;

      let winner = compareChunkStrength(candidate, existing) >= 0 ? candidate : existing;
      if (containmentConflict) {
        const existingLabel = String(existing.label || '').toUpperCase();
        const candidateLabel = String(candidate.label || '').toUpperCase();
        if ((candidateLabel === 'GREEN' && (existingLabel === 'RED' || existingLabel === 'BLUE'))) {
          winner = existing;
        } else if ((existingLabel === 'GREEN' && (candidateLabel === 'RED' || candidateLabel === 'BLUE'))) {
          winner = candidate;
        }
      }

      if (winner === existing) {
        dropped.push({ drop: candidate, keep: existing, reason: containmentConflict ? 'green-contained-by-frame' : 'overlap-lower-strength' });
        rejected = true;
      } else {
        dropped.push({ drop: existing, keep: candidate, reason: containmentConflict ? 'green-replaced-by-frame' : 'overlap-higher-strength' });
        resolved[i] = candidate;
        rejected = true;
      }
      break;
    }

    if (!rejected) {
      resolved.push(candidate);
    }
  }

  const ordered = resolved.sort((a, b) => {
    const aPos = source ? source.indexOf(String(a.normalized || '')) : -1;
    const bPos = source ? source.indexOf(String(b.normalized || '')) : -1;
    if (aPos === -1 && bPos === -1) return 0;
    if (aPos === -1) return 1;
    if (bPos === -1) return -1;
    return aPos - bPos;
  });

  return {
    chunks: ordered,
    conflictResolvedCount: dropped.length,
    dropped,
  };
}

function resolveFallbackLabel(normalized = '') {
  if (!normalized) return 'PINK';
  if (isRedIdiomCandidate(normalized)) return 'RED';
  if (normalized.startsWith('tôi không nghĩ') || normalized.startsWith('tui không nghĩ')) return 'BLUE';
  if (BLUE_FRAME_MARKERS.some((marker) => normalized.includes(marker))) return 'BLUE';
  if (isSentenceOpener(normalized, normalized)) return 'GREEN';
  return 'PINK';
}

function resolveNonZeroOhmForLabel(label = '', weights = { GREEN: 5, BLUE: 7, RED: 9, PINK: 3 }) {
  const configured = Number(weights[String(label || '').toUpperCase()] || 0);
  if (configured > 0) return configured;
  const fallback = Math.max(
    Number(weights.RED || 0),
    Number(weights.BLUE || 0),
    Number(weights.GREEN || 0),
    Number(weights.PINK || 0),
  );
  return fallback > 0 ? fallback : 1;
}

function buildNonZeroFallbackChunk(transcript = '', weights = { GREEN: 5, BLUE: 7, RED: 9, PINK: 3 }) {
  const normalizedTranscript = normalizeOhmText(transcript);
  const clauses = String(transcript || '')
    .split(/[.!?,;:\n\r]+/)
    .map((segment) => String(segment || '').trim())
    .filter(Boolean);

  const bestClause = clauses.find((segment) => normalizeOhmText(segment).split(/\s+/).filter(Boolean).length >= 3)
    || String(transcript || '').trim();

  const normalized = normalizeOhmText(bestClause);
  const label = resolveFallbackLabel(normalized);
  const ohm = resolveNonZeroOhmForLabel(label, weights);

  return {
    text: bestClause,
    label,
    ohm,
    confidence: 0.51,
    reason: 'non-zero safeguard fallback chunk for non-empty transcript',
    normalized,
    source: 'fallback',
    evidence: {
      lexiconExact: 0,
      lexiconFuzzy: 0,
      functional: isLabelChunkAcceptable(label, normalized, normalizedTranscript, 'model') ? 1 : 0,
      context: resolveContextSignal(label, normalized, normalizedTranscript),
      modelConfidence: 0.51,
      fuzzyLexiconLabel: null,
      fuzzyLexiconText: null,
    },
    evidenceScore: 0.51,
    verifierDecision: 'fallback',
    needsReview: true,
  };
}

function ensureNonZeroChunks(chunks = [], transcript = '', weights = { GREEN: 5, BLUE: 7, RED: 9, PINK: 3 }) {
  if (!String(transcript || '').trim()) {
    return { chunks, fallbackApplied: false };
  }

  if (Array.isArray(chunks) && chunks.length > 0) {
    return { chunks, fallbackApplied: false };
  }

  return {
    chunks: [buildNonZeroFallbackChunk(transcript, weights)],
    fallbackApplied: true,
  };
}

function logOhmTrainingSample(payload) {
  try {
    if (!admin?.firestore) return;
    const enabled = payload?.datasetCaptureEnabled !== false;
    if (!enabled) return;
    const sampleRate = Math.max(0, Math.min(1, Number(payload?.datasetSampleRate ?? 1)));
    if (Math.random() > sampleRate) return;

    const db = admin.firestore();
    db.collection('ohm_training_samples').add({
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      transcript: payload.transcript,
      transcriptNormalized: payload.transcriptNormalized,
      rawModelChunks: payload.rawModelChunks,
      modelChunks: payload.modelChunks,
      lexiconChunks: payload.lexiconChunks,
      mergedChunks: payload.mergedChunks,
      score: {
        baseOhm: payload.baseOhm,
        totalOhm: payload.totalOhm,
        formula: payload.formula,
        lengthBucket: payload.lengthBucket,
        lengthCoefficient: payload.lengthCoefficient,
      },
      model: {
        requested: payload.modelRequested,
        used: payload.modelUsed,
      },
      diagnostics: {
        elapsedMs: payload.elapsedMs,
        sentenceCount: payload.sentenceCount,
        wordCount: payload.wordCount,
        filteredChunkCount: payload.filteredChunkCount,
        verifierAppliedCount: payload.verifierAppliedCount,
        uncertainChunkCount: payload.uncertainChunkCount,
        conflictResolvedCount: payload.conflictResolvedCount,
        fallbackApplied: payload.fallbackApplied === true,
      },
      chunkDiagnostics: payload.chunkDiagnostics || [],
    }).catch((error) => logger.warn('Could not write ohm training sample', error));
  } catch (error) {
    logger.warn('Unexpected ohm dataset logging error', error);
  }
}


  return onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  try {
    if (handleOptions(req, res)) return;
    applyCors(res);

    const transcript = String(req.body?.transcript || '').trim();
    if (!transcript) throw new Error('Transcript is required');

    const sharedConfig = await getSharedAdminConfig();
    const explicitProvider = String(req.body?.ohmAnalysisProvider || process.env.OHM_ANALYSIS_PROVIDER || '').trim().toLowerCase();
    const analysisProvider = explicitProvider === 'router9' ? 'router9' : 'cvr-measure';
    const startedAt = Date.now();

    if (analysisProvider === 'cvr-measure') {
      const cvrResponse = await callCvrMeasure({
        baseUrl: req.body?.cvrMeasureBaseUrl || process.env.CVR_MEASURE_BASE_URL || sharedConfig?.cvrMeasureBaseUrl,
        apiKey: req.body?.cvrMeasureApiKey || process.env.CVR_MEASURE_API_KEY || sharedConfig?.cvrMeasureApiKey,
        timeoutMs: Math.max(45000, toFiniteNumber(req.body?.cvrMeasureTimeoutMs, toFiniteNumber(sharedConfig?.cvrMeasureTimeoutMs, 45000))),
        transcript,
        resources: req.body?.resources,
        tcCorrections: req.body?.tcCorrections,
        settings: req.body?.settings,
      });

      const responsePayload = mapCvrMeasureResponseToOhmPayload(cvrResponse, {
        elapsedMs: Date.now() - startedAt,
      });

      res.json(responsePayload);
      return;
    }

    const apiKey = req.body.routerApiKey || process.env.ROUTER9_API_KEY || sharedConfig.router9ApiKey;
    const baseUrl = req.body.routerBaseUrl || process.env.ROUTER9_BASE_URL || sharedConfig.router9BaseUrl || 'http://34.87.121.108:20128/v1';
    const model = String(req.body.model || sharedConfig.ohmModel || sharedConfig.router9Model || process.env.ROUTER9_MODEL || 'gpt').trim();
    const fallbackModel = String(req.body.fallbackModel || sharedConfig.ohmFallbackModel || sharedConfig.router9FallbackModel || process.env.ROUTER9_FALLBACK_MODEL || model).trim();
    const ohmSettings = normalizeOhmSettings(sharedConfig);

    const prompt = `You are an expert linguistic analyzer. Analyze transcript and extract semantic chunks in labels GREEN, BLUE, RED, PINK only.\n\nLabel definitions:\n- GREEN: discourse opener / sentence opener / transition starter.\n- BLUE: reusable sentence frame/pattern with slots.\n- RED: idioms, proverbs, figurative sayings. Proverbs must be RED (never GREEN).\n- PINK: difficult/specific vocabulary terms or collocations (not basic everyday words).\n\nRules:\n1) Do not classify everything. Most words are NORMAL and must be ignored.\n2) Extract exact substrings from transcript only.\n3) Do NOT classify single filler words, particles, or isolated question words (examples: liệu, à, ạ, hả, nhé).\n4) GREEN/BLUE/RED should usually be phrase-level (>= 2 words).\n5) If a phrase is an idiom/proverb, label it RED even if it appears at sentence start.\n6) Return valid JSON object only.\n7) Keep confidence in 0..1.\n\nTranscript:\n${JSON.stringify(transcript)}\n\nReturn JSON with keys: transcriptRaw, transcriptNormalized, chunks.\nEach chunk item must include text, label, confidence, reason.`;
    const agentEnabled = toBoolean(req.body?.useMemoryAssist, toBoolean(sharedConfig?.ohmAgentEnabled, false));
    const agentShadowMode = toBoolean(req.body?.agentShadowMode, toBoolean(sharedConfig?.ohmAgentShadowMode, true));
    const agentEndpoint = String(req.body?.agentEndpoint || sharedConfig?.ohmAgentEndpoint || '').trim();
    const agentApiKey = String(req.body?.agentApiKey || sharedConfig?.ohmAgentApiKey || '').trim();
    const agentAuthScheme = String(req.body?.agentAuthScheme || sharedConfig?.ohmAgentAuthScheme || 'bearer').trim().toLowerCase();
    const agentTimeoutMs = toFiniteNumber(req.body?.agentTimeoutMs, toFiniteNumber(sharedConfig?.ohmAgentTimeoutMs, 9000));

    const toRawChunksFromPayload = (payload) => {
      if (!Array.isArray(payload?.chunks)) return [];
      return payload.chunks
        .map((chunk) => {
          const text = String(chunk?.text || '');
          const normalized = normalizeOhmText(text);
          const label = coerceIdiomLabel(String(chunk?.label || '').toUpperCase(), normalized);
          return {
            text,
            label,
            ohm: Number(ohmSettings.weights[label] || 0),
            confidence: Number(chunk?.confidence || 0),
            reason: String(chunk?.reason || ''),
          };
        })
        .filter((chunk) => ['GREEN', 'BLUE', 'RED', 'PINK'].includes(chunk.label) && chunk.text);
    };

    const runLegacyRouterAnalysis = async () => {
      const completion = await callRouterChat({
        apiKey,
        baseUrl,
        model,
        fallbackModel,
        temperature: 0,
        timeoutMs: 20000,
        responseFormat: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Return strict JSON. Labels allowed: GREEN, BLUE, RED, PINK.' },
          { role: 'user', content: prompt },
        ],
      });

      const raw = completion?.choices?.[0]?.message?.content;
      const parsed = typeof raw === 'string' ? JSON.parse(extractFirstJsonObject(raw)) : (raw || {});
      return {
        parsed,
        rawChunks: toRawChunksFromPayload(parsed),
        modelUsed: String(completion?.model || model || fallbackModel || ''),
      };
    };

    let parsed = {};
    let rawChunks = [];
    let modelUsed = model || fallbackModel;
    let analysisSource = 'legacy-router9';
    let agentDiagnostics = null;

    if (agentEnabled && agentEndpoint) {
      const agentStartedAt = Date.now();
      try {
        const agentResponse = await callOhmAgent({
          endpoint: agentEndpoint,
          apiKey: agentApiKey,
          authScheme: agentAuthScheme,
          timeoutMs: agentTimeoutMs,
          payload: {
            transcript,
            model,
            fallbackModel,
            reactionDelayMs: req.body?.reactionDelayMs,
            flags: {
              useMemoryAssist: true,
              returnDebug: toBoolean(req.body?.returnDebug, true),
            },
            context: {
              sessionId: String(req.body?.sessionId || ''),
              roundId: String(req.body?.roundId || ''),
              userId: String(req.body?.userId || ''),
            },
          },
        });

        const agentParsed = typeof agentResponse === 'string'
          ? JSON.parse(extractFirstJsonObject(agentResponse))
          : (agentResponse || {});

        agentDiagnostics = {
          enabled: true,
          shadowMode: agentShadowMode,
          elapsedMs: Date.now() - agentStartedAt,
          memoryHits: toFiniteNumber(agentParsed?.diagnostics?.memoryHits, 0),
          rawChunkCount: toFiniteNumber(agentParsed?.diagnostics?.rawChunkCount, Array.isArray(agentParsed?.chunks) ? agentParsed.chunks.length : 0),
          selfCheckPassed: toBoolean(agentParsed?.diagnostics?.selfCheckPassed, false),
        };

        if (!agentShadowMode) {
          parsed = agentParsed;
          rawChunks = toRawChunksFromPayload(agentParsed);
          modelUsed = String(agentParsed?.modelUsed || 'ohm-memory-agent');
          analysisSource = 'agent';
        } else {
          const legacy = await runLegacyRouterAnalysis();
          parsed = legacy.parsed;
          rawChunks = legacy.rawChunks;
          modelUsed = legacy.modelUsed;
        }
      } catch (agentError) {
        logger.warn('OHM agent integration call failed, falling back to legacy analyzer', agentError);
        agentDiagnostics = {
          enabled: true,
          shadowMode: agentShadowMode,
          error: String(agentError?.message || agentError),
          elapsedMs: Date.now() - agentStartedAt,
        };

        const legacy = await runLegacyRouterAnalysis();
        parsed = legacy.parsed;
        rawChunks = legacy.rawChunks;
        modelUsed = legacy.modelUsed;
      }
    } else {
      const legacy = await runLegacyRouterAnalysis();
      parsed = legacy.parsed;
      rawChunks = legacy.rawChunks;
      modelUsed = legacy.modelUsed;
    }

    const modelChunks = sanitizeOhmChunks(rawChunks, transcript);
    const lexiconChunks = detectLexiconChunks(transcript, ohmSettings.weights);
    const compositeChunks = detectCompositeIdiomChunks(transcript, ohmSettings.weights);
    const mergedChunks = mergeLexiconAndModelChunks(compositeChunks, lexiconChunks, modelChunks, transcript);
    const verified = applyChunkVerifier(mergedChunks, transcript, ohmSettings.weights);
    const resolved = resolveChunkConflicts(verified.chunks, transcript);
    const ensured = ensureNonZeroChunks(resolved.chunks, transcript, ohmSettings.weights);
    const chunks = ensured.chunks;

    const { baseOhm, formula: baseFormula } = computeOhmFromChunks(chunks, ohmSettings.weights);
    const { sentenceCount, wordCount, lengthBucket } = resolveLengthBucket(transcript, ohmSettings.constraints);
    const lengthCoefficient = Number(ohmSettings.coefficients[lengthBucket] || ohmSettings.coefficients.overLong || 2.5);
    const totalOhm = Number((baseOhm * lengthCoefficient).toFixed(4));
    const formula = baseOhm > 0 ? `${baseFormula} x ${lengthCoefficient}` : '0';
    const elapsedMs = Date.now() - startedAt;
    const transcriptNormalized = String(parsed?.transcriptNormalized || '');

    const responsePayload = {
      transcriptRaw: String(parsed?.transcriptRaw || transcript),
      transcriptNormalized,
      chunks,
      formula,
      totalOhm,
      modelUsed,
      baseOhm,
      lengthBucket,
      lengthCoefficient,
      sentenceCount,
      wordCount,
      elapsedMs,
      analysisSource,
      responseCoefficient: 1,
      responseCoefficientApplied: false,
      filteredChunkCount: Math.max(0, rawChunks.length - modelChunks.length),
      lexiconChunkCount: lexiconChunks.length,
      compositeChunkCount: compositeChunks.length,
      verifierAppliedCount: verified.verifierAppliedCount,
      uncertainChunkCount: verified.uncertainChunkCount,
      conflictResolvedCount: resolved.conflictResolvedCount,
      fallbackApplied: ensured.fallbackApplied,
      agentDiagnostics,
      chunkDiagnostics: ensured.fallbackApplied
        ? [...verified.diagnostics, ...resolved.dropped.map((entry) => ({
            text: String(entry?.drop?.text || ''),
            normalized: String(entry?.drop?.normalized || normalizeOhmText(entry?.drop?.text || '')),
            source: String(entry?.drop?.source || 'unknown'),
            inputLabel: String(entry?.drop?.label || 'NONE'),
            verifierDecision: 'dropped',
            verifierReason: String(entry?.reason || 'conflict-resolved'),
            finalLabel: String(entry?.keep?.label || 'NONE'),
            evidenceScore: Number(entry?.drop?.evidenceScore || 0),
            verifierScore: Number(entry?.keep?.evidenceScore || 0),
            needsReview: true,
            topCandidates: [],
            evidence: entry?.drop?.evidence || null,
          })), {
            text: chunks[0]?.text || '',
            normalized: chunks[0]?.normalized || normalizeOhmText(chunks[0]?.text || ''),
            source: 'fallback',
            inputLabel: 'NONE',
            verifierDecision: 'fallback',
            verifierReason: 'non-empty transcript safeguard',
            finalLabel: chunks[0]?.label || 'PINK',
            evidenceScore: Number(chunks[0]?.evidenceScore || 0.51),
            verifierScore: Number(chunks[0]?.evidenceScore || 0.51),
            needsReview: true,
            topCandidates: [],
            evidence: chunks[0]?.evidence || null,
          }]
        : [...verified.diagnostics, ...resolved.dropped.map((entry) => ({
            text: String(entry?.drop?.text || ''),
            normalized: String(entry?.drop?.normalized || normalizeOhmText(entry?.drop?.text || '')),
            source: String(entry?.drop?.source || 'unknown'),
            inputLabel: String(entry?.drop?.label || 'NONE'),
            verifierDecision: 'dropped',
            verifierReason: String(entry?.reason || 'conflict-resolved'),
            finalLabel: String(entry?.keep?.label || 'NONE'),
            evidenceScore: Number(entry?.drop?.evidenceScore || 0),
            verifierScore: Number(entry?.keep?.evidenceScore || 0),
            needsReview: true,
            topCandidates: [],
            evidence: entry?.drop?.evidence || null,
          }))],
    };

    logOhmTrainingSample({
      transcript,
      transcriptNormalized,
      rawModelChunks: rawChunks,
      modelChunks,
      lexiconChunks,
      compositeChunks,
      mergedChunks: chunks,
      baseOhm,
      totalOhm,
      formula,
      lengthBucket,
      lengthCoefficient,
      sentenceCount,
      wordCount,
      elapsedMs,
      filteredChunkCount: responsePayload.filteredChunkCount,
      verifierAppliedCount: responsePayload.verifierAppliedCount,
      uncertainChunkCount: responsePayload.uncertainChunkCount,
      conflictResolvedCount: responsePayload.conflictResolvedCount,
      fallbackApplied: responsePayload.fallbackApplied,
      chunkDiagnostics: responsePayload.chunkDiagnostics,
      modelRequested: model,
      modelUsed,
      datasetCaptureEnabled: sharedConfig?.ohmDatasetCaptureEnabled,
      datasetSampleRate: sharedConfig?.ohmDatasetSampleRate,
    });

    res.json(responsePayload);
  } catch (error) {
    logger.error(error);
    applyCors(res);
    res.status(500).json({ error: error.message || 'Transcript analysis failed' });
  }
  });
}

module.exports = {
  createAnalyzeTranscriptOhmHandler,
};
