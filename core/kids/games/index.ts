import { themeFor } from '../content';
import type { GameId, GameInstance, Theme } from '../types';
import { GAME_SPECS } from './specs';
import { MemoryMatchGame } from './memory_match';
import { PathPuzzleGame } from './path_puzzle';
import { PatternLogicGame } from './pattern_logic';
import { ReactionControlGame } from './reaction_control';
import { RuleSwitchGame } from './rule_switch';
import { VisualAttentionGame } from './visual_attention';

export { GAME_SPECS, gameSpec } from './specs';
export { MemoryMatchGame, PathPuzzleGame, PatternLogicGame, ReactionControlGame, RuleSwitchGame, VisualAttentionGame };

/** Registry: new games plug in here; the adaptive / journey / growth engines only know GAME_SPECS + the GameInstance contract. */
export function createGame(gameId: GameId, level: number, seed: string, theme?: Theme): GameInstance<any> {
  const th = theme ?? themeFor(seed, gameId, 0);
  switch (gameId) {
    case 'memory_match': return new MemoryMatchGame(level, seed, th);
    case 'visual_attention': return new VisualAttentionGame(level, seed, th);
    case 'pattern_logic': return new PatternLogicGame(level, seed, th);
    case 'reaction_control': return new ReactionControlGame(level, seed, th);
    case 'path_puzzle': return new PathPuzzleGame(level, seed, th);
    case 'rule_switch': return new RuleSwitchGame(level, seed, th);
  }
}
