import { describe, expect, test } from 'vitest';
import { buildRoundMetrics } from '../packages/shared-types/src';
import type {
  SummaryLocationState,
  TranscriptResult,
  RoundRecord,
  RoomRoundDoc,
} from '../packages/shared-types/src';

describe('shared type contracts', () => {
  test('SummaryLocationState includes verified transcripts and OHM analysis fields', () => {
    const transcript: TranscriptResult = {
      transcript: 'hello world',
      confidence: 0.9,
      duration: 2.5,
      source: 'batch',
      transcriptProviderUsed: 'deepgram',
    };

    const summary: SummaryLocationState = {
      evaluation: null,
      reactionDelayMs: 2100,
      captainTranscript: transcript,
      crewTranscript: transcript,
      captainVerifiedTranscript: transcript,
      crewVerifiedTranscript: transcript,
      ohmResult: {
        totalOhm: 12,
        formula: '(5 + 7) x 1',
        voltage: 12,
        current: 1,
        difficulty: 'Beginner',
        score: 10,
        chunkCount: 2,
        chunks: [
          { text: 'honestly', label: 'GREEN', ohm: 5 },
          { text: 'you should', label: 'BLUE', ohm: 7 },
        ],
      },
    };

    expect(summary.ohmResult?.chunkCount).toBe(2);
    expect(summary.captainVerifiedTranscript?.transcriptProviderUsed).toBe('deepgram');
  });

  test('RoundRecord and RoomRoundDoc accept transcript metadata from the shared contract', () => {
    const transcript: TranscriptResult = {
      transcript: 'captain message',
      confidence: 0.85,
      duration: 1.6,
      source: 'streaming-fallback-batch',
      transcriptProviderUsed: 'google',
    };

    const metrics = buildRoundMetrics({
      ohmResult: {
        totalOhm: 24,
        formula: '(5 + 7) x 2',
        voltage: 24,
        current: 2,
        estimatedTC: 12,
        linguisticComplexity: 2,
        tensionLoad: 1,
        responseCoefficient: 1,
        repeatCoefficient: 1,
        difficulty: 'Beginner',
        score: 20,
        chunkCount: 2,
        chunks: [
          { text: 'honestly', label: 'GREEN', ohm: 5 },
          { text: 'you should', label: 'BLUE', ohm: 7 },
        ],
      },
      evaluation: {
        matchScore: 80,
        decision: 'match',
        reason: 'Meaning preserved.',
      },
      mseCoefficient: 1,
    });

    const round: RoundRecord = {
      id: 'round-1',
      createdAt: '2026-05-01T00:00:00Z',
      state: 'results',
      captainTranscript: transcript,
      crewTranscript: transcript,
      metrics,
      timeoutLost: false,
    };

    const roomRound: RoomRoundDoc = {
      roomId: 'room-1',
      roundNumber: 1,
      status: 'finished',
      createdAt: new Date().toISOString(),
      captainTranscriptMeta: round.captainTranscript,
      crewTranscriptMeta: round.crewTranscript,
      metrics: round.metrics,
    };

    expect(roomRound.metrics?.cvr.unit).toBe('Ω');
    expect(roomRound.metrics?.cci.unit).toBe('A');
    expect(roomRound.metrics?.cpd.unit).toBe('V');
    expect(roomRound.metrics?.cvr.estimatedTC).toBe(12);
    expect(roomRound.metrics?.cvr.linguisticComplexity).toBe(2);
    expect(roomRound.metrics?.cvr.tensionLoad).toBe(1);
    expect(roomRound.metrics?.cvr.repeatCoefficient).toBe(1);
    expect(roomRound.metrics?.scoringVersion).toBe('cvr-cci-cpd-v2');
    expect(roomRound.metrics?.cci.llmMeaningPercent).toBe(80);
    expect(roomRound.metrics?.cci.card.id).toBe('1-on-1');
    expect(roomRound.metrics?.cci.card.baseA).toBe(10);
    expect(roomRound.metrics?.cci.score).toBe(8);
    expect(roomRound.metrics?.cci.current).toBe(8);
    expect(roomRound.metrics?.cpd.raw).toBe(192);
    expect(roomRound.captainTranscriptMeta?.source).toBe('streaming-fallback-batch');
    expect(roomRound.crewTranscriptMeta?.transcriptProviderUsed).toBe('google');
  });
});
