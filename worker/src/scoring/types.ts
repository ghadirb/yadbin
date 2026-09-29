export type GameType = 'memory' | 'attention' | 'problem_solving';
export const GAME_TYPES: GameType[] = ['memory', 'attention', 'problem_solving'];

export interface MemoryEvent {
  sequenceLength: number; displayDuration: number; difficulty: number;
  isReverse: boolean; correct: boolean; attempts: number; responseTime: number; mistakes: number;
}
export interface AttentionEvent {
  gridSize: number; targetType: string; targetCount: number; correctTargets: number;
  wrongTargets: number; missedTargets: number; falseClicks: number; reactionTime: number;
  totalTime: number; difficulty: number; ruleChanged: boolean; phase: 'before' | 'after' | 'none';
}
export interface ProblemEvent {
  questionId: string; difficulty: number; attempts: number; hintsUsed: number; // 0..3 (hint1, hint2, example)
  responseTime: number; finalAnswer: number | null;
  /** Server-derived from the question bank; client-provided value is ignored. */
  correct?: boolean;
}

/** Internal metrics. Never shown to the child; teacher UI shows descriptive status only. */
export interface GameMetrics {
  game: GameType;
  sampleCount: number;
  accuracy: number | null;            // 0..1
  averageResponseTime: number | null; // ms
  difficultyReached: number;          // 1..3
  hintsUsed: number;
  independenceScore: number | null;   // 0..1 (problem solving only)
  helpResponseScore: number | null;   // 0..1 (problem solving only)
  details: Record<string, number | null>;
}
export type PerformanceStatus = 'good' | 'average' | 'needs_practice' | 'insufficient';
export type TrendDirection = 'up' | 'stable' | 'down' | 'insufficient';
