import {
    effectiveGoalStreak,
    effectivePracticeStreak,
    freezesAfterPractice,
    habitMotivation,
    isStreakAtRisk,
    isStreakMilestone,
    lastNDays,
    nextGoalStreak,
    nextPracticeStreak,
    nextPracticeStreakWithFreezes,
    nextStreakMilestone,
    resolveDisplayStreak,
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

    it('keeps the practice streak alive when last practice was yesterday', () => {
        expect(
            effectivePracticeStreak(9, parseClientDate(yesterday), today),
        ).toBe(9);
    });

    it('lapses a stale practice streak after a missed day', () => {
        expect(
            effectivePracticeStreak(9, parseClientDate('2026-06-03'), today),
        ).toBe(0);
    });

    it('keeps the streak shown when already practiced today', () => {
        expect(effectivePracticeStreak(9, parseClientDate(today), today)).toBe(
            9,
        );
    });

    it('flags a streak as at risk when yesterday was the last practice', () => {
        expect(isStreakAtRisk(9, parseClientDate(yesterday), today)).toBe(true);
    });

    it('does not flag at risk once practiced today', () => {
        expect(isStreakAtRisk(9, parseClientDate(today), today)).toBe(false);
    });

    it('does not flag at risk for a broken streak', () => {
        expect(isStreakAtRisk(9, parseClientDate('2026-06-03'), today)).toBe(
            false,
        );
    });

    it('finds the next streak milestone', () => {
        expect(nextStreakMilestone(0)).toBe(7);
        expect(nextStreakMilestone(7)).toBe(14);
        expect(nextStreakMilestone(29)).toBe(30);
        expect(nextStreakMilestone(365)).toBeNull();
    });

    it('recognizes milestone streak lengths', () => {
        expect(isStreakMilestone(7)).toBe(true);
        expect(isStreakMilestone(8)).toBe(false);
    });

    it('warns when a live streak is at risk and nothing done today', () => {
        expect(
            habitMotivation({
                goalMetToday: false,
                wordsToday: 0,
                goal: 10,
                streak: 9,
                goalStreak: 0,
                wordsRemaining: 10,
                streakAtRisk: true,
            }),
        ).toContain("Don't lose your 9-day streak");
    });

    it('celebrates hitting a milestone', () => {
        expect(
            habitMotivation({
                goalMetToday: true,
                wordsToday: 10,
                goal: 10,
                streak: 7,
                goalStreak: 3,
                wordsRemaining: 0,
            }),
        ).toContain('milestone');
    });

    describe('streak freezes', () => {
        const twoDaysAgo = '2026-06-03';
        const threeDaysAgo = '2026-06-02';
        const fourDaysAgo = '2026-06-01';

        it('shields the streak when one day is missed and a freeze is banked', () => {
            expect(
                resolveDisplayStreak({
                    streak: 9,
                    lastPracticeDate: parseClientDate(twoDaysAgo),
                    freezes: 1,
                    clientDate: today,
                }),
            ).toEqual({ streak: 9, shielded: true, freezesRemaining: 0 });
        });

        it('deducts the bridging freeze from the displayed balance', () => {
            expect(
                resolveDisplayStreak({
                    streak: 9,
                    lastPracticeDate: parseClientDate(twoDaysAgo),
                    freezes: 2,
                    clientDate: today,
                }),
            ).toEqual({ streak: 9, shielded: true, freezesRemaining: 1 });
        });

        it('deducts one freeze per missed day', () => {
            expect(
                resolveDisplayStreak({
                    streak: 9,
                    lastPracticeDate: parseClientDate(threeDaysAgo),
                    freezes: 2,
                    clientDate: today,
                }),
            ).toEqual({ streak: 9, shielded: true, freezesRemaining: 0 });
        });

        it('breaks the streak and burns the bank when missed days exceed banked freezes', () => {
            expect(
                resolveDisplayStreak({
                    streak: 9,
                    lastPracticeDate: parseClientDate(threeDaysAgo),
                    freezes: 1,
                    clientDate: today,
                }),
            ).toEqual({ streak: 0, shielded: false, freezesRemaining: 0 });
        });

        it('spends both freezes on a 3-day gap and still lapses', () => {
            // 2 banked, 3 missed: the bank empties without saving the streak.
            expect(
                resolveDisplayStreak({
                    streak: 9,
                    lastPracticeDate: parseClientDate(fourDaysAgo),
                    freezes: 2,
                    clientDate: today,
                }),
            ).toEqual({ streak: 0, shielded: false, freezesRemaining: 0 });
        });

        it('treats yesterday as live without a shield', () => {
            expect(
                resolveDisplayStreak({
                    streak: 9,
                    lastPracticeDate: parseClientDate(yesterday),
                    freezes: 2,
                    clientDate: today,
                }),
            ).toEqual({ streak: 9, shielded: false, freezesRemaining: 2 });
        });

        it('consumes a freeze to bridge a missed day on practice', () => {
            expect(
                nextPracticeStreakWithFreezes({
                    currentStreak: 9,
                    lastPracticeDate: parseClientDate(twoDaysAgo),
                    freezes: 1,
                    clientDate: today,
                }),
            ).toEqual({ streak: 10, freezesConsumed: 1 });
        });

        it('resets and spends the whole bank when the gap is too wide', () => {
            expect(
                nextPracticeStreakWithFreezes({
                    currentStreak: 9,
                    lastPracticeDate: parseClientDate(fourDaysAgo),
                    freezes: 2,
                    clientDate: today,
                }),
            ).toEqual({ streak: 1, freezesConsumed: 2 });
        });

        it('zeroes the balance after a lapse consumed every freeze', () => {
            expect(
                freezesAfterPractice({
                    currentFreezes: 2,
                    freezesConsumed: 2,
                    prevGoalStreak: 4,
                    newGoalStreak: 1,
                    goalMetToday: false,
                }),
            ).toBe(0);
        });

        it('continues from yesterday without spending a freeze', () => {
            expect(
                nextPracticeStreakWithFreezes({
                    currentStreak: 9,
                    lastPracticeDate: parseClientDate(yesterday),
                    freezes: 2,
                    clientDate: today,
                }),
            ).toEqual({ streak: 10, freezesConsumed: 0 });
        });

        it('earns the first freeze after a 3-day goal streak', () => {
            expect(
                freezesAfterPractice({
                    currentFreezes: 0,
                    freezesConsumed: 0,
                    prevGoalStreak: 2,
                    newGoalStreak: 3,
                    goalMetToday: true,
                }),
            ).toBe(1);
        });

        it('earns the last freeze after a 5-day goal streak', () => {
            expect(
                freezesAfterPractice({
                    currentFreezes: 1,
                    freezesConsumed: 0,
                    prevGoalStreak: 4,
                    newGoalStreak: 5,
                    goalMetToday: true,
                }),
            ).toBe(2);
        });

        it('earns nothing on goal-streak days between thresholds', () => {
            expect(
                freezesAfterPractice({
                    currentFreezes: 1,
                    freezesConsumed: 0,
                    prevGoalStreak: 3,
                    newGoalStreak: 4,
                    goalMetToday: true,
                }),
            ).toBe(1);
        });

        it('caps the freeze balance', () => {
            expect(
                freezesAfterPractice({
                    currentFreezes: 2,
                    freezesConsumed: 0,
                    prevGoalStreak: 9,
                    newGoalStreak: 10,
                    goalMetToday: true,
                }),
            ).toBe(2);
        });

        it('spends consumed freezes before awarding new ones', () => {
            expect(
                freezesAfterPractice({
                    currentFreezes: 1,
                    freezesConsumed: 1,
                    prevGoalStreak: 3,
                    newGoalStreak: 4,
                    goalMetToday: true,
                }),
            ).toBe(0);
        });
    });
});
