import {
  effectiveGoalStreak,
  habitMotivation,
  lastNDays,
  nextGoalStreak,
  nextPracticeStreak,
} from './daily-habit.logic';
import { parseClientDate } from './daily-habit-date.util';

describe('daily-habit.logic', () => {
  const today = '2026-06-05';
  const yesterday = '2026-06-04';

  it('builds a 7-day range ending on client date', () => {
    expect(lastNDays(today, 7)).toEqual([
      '2026-05-30',
      '2026-05-31',
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
    ]);
  });

  it('continues practice streak from yesterday', () => {
    expect(
      nextPracticeStreak(
        4,
        parseClientDate(yesterday),
        parseClientDate(today),
        parseClientDate(yesterday),
      ),
    ).toBe(5);
  });

  it('tracks goal streak separately from practice streak', () => {
    const result = nextGoalStreak(
      2,
      parseClientDate(yesterday),
      parseClientDate(today),
      parseClientDate(yesterday),
      true,
    );
    expect(result.goalStreak).toBe(3);
  });

  it('hides stale goal streaks after a missed day', () => {
    expect(
      effectiveGoalStreak(5, parseClientDate('2026-06-01'), today),
    ).toBe(0);
  });

  it('generates contextual motivation copy', () => {
    expect(
      habitMotivation({
        goalMetToday: false,
        wordsToday: 8,
        goal: 10,
        streak: 3,
        goalStreak: 1,
        wordsRemaining: 2,
      }),
    ).toContain('Almost there');
  });
});
