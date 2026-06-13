import type { MeaningEvaluation, OhmResult, RoundMetrics, TranscriptResult } from '@/types';

export type RoomStatus = 'waiting' | 'playing' | 'finished';
export type RoundStatus = 'captain_speaking' | 'crew_speaking' | 'evaluating' | 'finished';

export interface RoomDoc {
  hostId: string;
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
  // Team faceoff (optional — only present when teamMode active)
  teamMode?: boolean;
  teamA?: string[];        // UIDs for Team A (starts as Captain team)
  teamB?: string[];        // UIDs for Team B (starts as Crew team)
  teamANames?: string[];
  teamBNames?: string[];
  teamAIndex?: number;     // rotating slot pointer for Team A
  teamBIndex?: number;     // rotating slot pointer for Team B
  swapAfterRound?: boolean;
}

export interface RoomRoundDoc {
  roomId: string;
  roundNumber: number;
  status: RoundStatus;
  createdAt: any;

  captainStoppedAtMs?: number;
  crewStartedAtMs?: number;

  // Optional timeout metadata
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
