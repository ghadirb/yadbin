import type { GameAggregate } from './aggregate';
import type { GameType } from './types';

export interface Suggestion {
  rule: string;
  gameType: GameType;
  difficultyMode: 'adaptive' | 'easy' | 'medium' | 'hard';
  /** Descriptive Persian text shown under the label «پیشنهاد سیستم». The teacher decides. */
  text: string;
}

/** Version 1: rule-based, descriptive, never diagnostic. Only reasons from sufficient data. */
export function recommend(aggs: Partial<Record<GameType, GameAggregate>>): Suggestion[] {
  const out: Suggestion[] = [];
  const att = aggs.attention, prob = aggs.problem_solving, mem = aggs.memory;

  if (att?.sufficientData && att.ruleAdaptation !== null && att.ruleAdaptation < 0.7)
    out.push({ rule: 'attention_rule_change', gameType: 'attention', difficultyMode: 'hard',
      text: 'در فعالیت‌های دارای تغییر قانون، تعداد خطاها افزایش یافت. فعالیت «پیداش کن» با تغییر قانون پیشنهاد می‌شود.' });

  if (prob?.sufficientData && prob.independentAccuracy !== null && prob.independentAccuracy < 0.6)
    out.push({ rule: 'problem_independent', gameType: 'problem_solving', difficultyMode: 'medium',
      text: 'پاسخ‌های مستقل (بدون راهنمایی) کمتر بود. مسئله‌های متوسط با تمرکز بر حل مستقل پیشنهاد می‌شود.' });
  else if (prob?.sufficientData && prob.helpResponsiveness !== null && prob.helpResponsiveness >= 0.7)
    out.push({ rule: 'problem_help_responsive', gameType: 'problem_solving', difficultyMode: 'hard',
      text: 'پس از راهنمایی معمولاً پاسخ درست داده شد. فعالیتی کمی دشوارتر پیشنهاد می‌شود.' });

  if (mem?.sufficientData && mem.accuracy !== null) {
    if (mem.accuracy >= 0.8)
      out.push({ rule: 'memory_step_up', gameType: 'memory', difficultyMode: (mem.highestDifficulty ?? 1) >= 2 ? 'hard' : 'medium',
        text: 'دقت در «به خاطر بسپار» خوب بود. فعالیتی با دنباله‌های بلندتر پیشنهاد می‌شود.' });
    else if (mem.accuracy < 0.5)
      out.push({ rule: 'memory_practice', gameType: 'memory', difficultyMode: 'easy',
        text: 'برای «به خاطر بسپار» تمرین بیشتر در سطح آسان پیشنهاد می‌شود.' });
  }

  if (att?.sufficientData && att.accuracy !== null && att.accuracy >= 0.8 && !out.some((s) => s.gameType === 'attention'))
    out.push({ rule: 'attention_step_up', gameType: 'attention', difficultyMode: 'hard',
      text: 'دقت در «پیداش کن» خوب بود. فعالیتی با تغییر قانون پیشنهاد می‌شود.' });

  return out;
}

export const NO_SUGGESTION_TEXT_FA = 'برای ارائه پیشنهاد، فعالیت‌های بیشتری لازم است.';
