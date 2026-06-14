/** SuperMemo-2 spaced-repetition scheduling. */
export interface SrsState {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
}

export interface SrsResult extends SrsState {
  dueAt: Date;
}

/**
 * @param prev current SRS state
 * @param grade recall quality 0–5 (0=blackout, 5=perfect)
 * @param now  current time
 */
export function sm2(prev: SrsState, grade: number, now: Date): SrsResult {
  let { easeFactor, intervalDays, repetitions } = prev;

  if (grade < 3) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    repetitions += 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 6;
    else intervalDays = Math.round(intervalDays * easeFactor);
  }

  easeFactor =
    easeFactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
  if (easeFactor < 1.3) easeFactor = 1.3;

  const dueAt = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  return { easeFactor, intervalDays, repetitions, dueAt };
}
