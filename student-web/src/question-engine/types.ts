import type { GameType } from '../scoring';
export type { GameType };

export interface Question { id: string; game: GameType; difficulty: 1 | 2 | 3; [k: string]: any }
export interface Pools { [level: string]: Question[] }

export interface PlayPayload {
  status: 'ready' | 'resume';
  session: { id: string; startedAt: string };
  game: GameType;
  difficultyMode: 'adaptive' | 'easy' | 'medium' | 'hard';
  questionCount: number;
  startDifficulty: 1 | 2 | 3;
  seed: string;
  pools: Pools;
}

/** Persisted (IndexedDB) so closing the page mid-game resumes exactly where the child stopped. */
export interface SessionState {
  sessionId: string;
  game: GameType;
  difficultyMode: PlayPayload['difficultyMode'];
  questionCount: number;
  pools: Pools;
  difficulty: 1 | 2 | 3;
  used: string[];
  events: any[];
  blockScores: number[];
  tutorialDone: boolean;
  startedAtMs: number;
  activeMs: number;
  finished: boolean;
}
