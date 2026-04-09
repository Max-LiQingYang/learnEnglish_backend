/**
 * SM-2 Spaced Repetition Algorithm
 * https://www.supermemo.com/en/blog/application-of-a-computer-to-improve-the-results-obtained-in-working-with-the-supermemo-method
 *
 * Quality ratings (0-5):
 *   5 - Perfect response
 *   4 - Correct response after a hesitation
 *   3 - Correct response recalled with serious difficulty
 *   2 - Incorrect response; where the correct one seemed easy to recall
 *   1 - Incorrect response; the correct one remembered
 *   0 - Complete blackout
 */

export interface SM2State {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
}

export interface SM2Result extends SM2State {
  nextReview: Date;
  status: 'learning' | 'mastered' | 'weak';
}

export function sm2(state: SM2State, quality: number): SM2Result {
  let { easeFactor, intervalDays, repetitions } = state;

  if (quality < 3) {
    // Failed: reset repetitions, keep ease, review soon
    repetitions = 0;
    intervalDays = 1;
  } else {
    // Correct response
    if (repetitions === 0) {
      intervalDays = 1;
    } else if (repetitions === 1) {
      intervalDays = 6;
    } else {
      intervalDays = Math.round(intervalDays * easeFactor);
    }
    repetitions += 1;

    // Update ease factor
    easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (easeFactor < 1.3) easeFactor = 1.3;
  }

  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + intervalDays);

  const status: SM2Result['status'] =
    quality < 3 ? 'weak' : repetitions >= 5 && intervalDays >= 21 ? 'mastered' : 'learning';

  return { easeFactor, intervalDays, repetitions, nextReview, status };
}

/** Return words due for review today */
export function isDueToday(nextReview: Date): boolean {
  const now = new Date();
  return nextReview <= now;
}
