// Local scoring uses the SAME pure module as the server (single source of truth, no drift).
export { scoreMemory, scoreAttention, scoreProblemSolving, nextDifficulty, ADAPTIVE_BLOCK_SIZE } from '../../../worker/src/scoring';
export type { GameMetrics, GameType, MemoryEvent, AttentionEvent, ProblemEvent } from '../../../worker/src/scoring';
