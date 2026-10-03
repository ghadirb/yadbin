import type { GameType } from '../scoring';
export type { GameType };

export interface Question { id: string; game: GameType; difficulty: 1 | 2 | 3; [k: string]: any }
export interface Pools { [level: string]: Question[] }

/** Teacher preview only (the server adds these fields to /api/preview/:token). */
export interface PreviewSummary {
  gameName: string; gradeLabel: string | null; ageLabel: string | null; skillLabels: string[]; levelLabel: string | null;
  difficultyLabel: string; questionCount: number; estimatedMinutes: number; comparison: boolean; note: string;
}
export interface PreviewInfo { comparison: boolean; summary: PreviewSummary | null }

export interface PlayPayload {
  status: 'ready' | 'resume';
  session: { id: string; startedAt: string };
  game: GameType;
  difficultyMode: 'adaptive' | 'easy' | 'medium' | 'hard';
  questionCount: number;
  startDifficulty: 1 | 2 | 3;
  seed: string;
  pools: Pools;
  preview?: boolean; comparison?: boolean; summary?: PreviewSummary | null;
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
  /** Set only for a teacher preview, so a resumed preview still shows the teacher screens. */
  preview?: PreviewInfo;
}
