import {
    addClientDays,
    bridgeableGap,
    effectiveGoalStreak,
    effectivePracticeStreak,
    freezesAfterPractice,
    habitMotivation,
    isStreakAtRisk,
    isStreakMilestone,
    lastNDays,
    mergePracticeDays,
    nextGoalStreak,
    nextPracticeStreak,
    nextPracticeStreakWithFreezes,
    nextStreakMilestone,
    reconcileFrozenGaps,
    recomputeHabitFromDays,
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

describe('recomputeHabitFromDays', () => {
    const day = (date: string, words = 10, goalMet = true) => ({
        date,
        words,
        goalMet,
    });

    it('returns zeros for an empty history', () => {
        const result = recomputeHabitFromDays([], '2026-06-05');

        expect(result).toEqual({
            streak: 0,
            longestStreak: 0,
            goalStreak: 0,
            longestGoalStreak: 0,
            wordsToday: 0,
            lastPracticeDate: null,
            lastGoalMetDate: null,
            totalGoalDays: 0,
            totalPracticeDays: 0,
        });
    });

    it('counts a contiguous run ending today', () => {
        const result = recomputeHabitFromDays(
            [day('2026-06-03'), day('2026-06-04'), day('2026-06-05')],
            '2026-06-05',
        );

        expect(result.streak).toBe(3);
        expect(result.wordsToday).toBe(10);
    });

    it('keeps the streak alive when the run ended yesterday', () => {
        const result = recomputeHabitFromDays(
            [day('2026-06-03'), day('2026-06-04')],
            '2026-06-05',
        );

        expect(result.streak).toBe(2);
        expect(result.wordsToday).toBe(0);
    });

    it('reports a broken streak when the run ended three days ago', () => {
        const result = recomputeHabitFromDays(
            [day('2026-06-01'), day('2026-06-02')],
            '2026-06-05',
        );

        expect(result.streak).toBe(0);
        expect(result.longestStreak).toBe(2);
    });

    it('joins two runs when a backdated day fills the gap', () => {
        // The headline fix: nextPracticeStreakWithFreezes structurally cannot do
        // this, because a non-positive day delta is absorbed and the gap remains.
        const withGap = recomputeHabitFromDays(
            [
                day('2026-06-01'),
                day('2026-06-02'),
                day('2026-06-04'),
                day('2026-06-05'),
            ],
            '2026-06-05',
        );
        expect(withGap.streak).toBe(2);

        const filled = recomputeHabitFromDays(
            [
                day('2026-06-01'),
                day('2026-06-02'),
                day('2026-06-03'),
                day('2026-06-04'),
                day('2026-06-05'),
            ],
            '2026-06-05',
        );
        expect(filled.streak).toBe(5);
        expect(filled.longestStreak).toBe(5);
    });

    it('finds a longest streak the current streak never reaches', () => {
        const result = recomputeHabitFromDays(
            [
                day('2026-05-01'),
                day('2026-05-02'),
                day('2026-05-03'),
                day('2026-05-04'),
                day('2026-06-05'),
            ],
            '2026-06-05',
        );

        expect(result.streak).toBe(1);
        expect(result.longestStreak).toBe(4);
    });

    it('bridges a frozen gap without counting the frozen days', () => {
        // The reported bug: 45-day streak, two days missed and paid for with
        // freezes, then a session on the third day. The streak must reach 46 —
        // the frozen days keep the chain, they are not practice days.
        const days = [
            ...Array.from({ length: 45 }, (_, index) =>
                day(addClientDays('2026-06-01', index)),
            ),
            { ...day('2026-07-16', 0, false), frozen: true },
            { ...day('2026-07-17', 0, false), frozen: true },
            day('2026-07-18'),
        ];

        const result = recomputeHabitFromDays(days, '2026-07-18');

        expect(result.streak).toBe(46);
        expect(result.longestStreak).toBe(46);
        expect(result.lastPracticeDate).toBe('2026-07-18');
        expect(result.totalPracticeDays).toBe(46);
    });

    it('keeps growing the streak on the days after a frozen gap', () => {
        const days = [
            day('2026-06-01'),
            day('2026-06-02'),
            { ...day('2026-06-03', 0, false), frozen: true },
            day('2026-06-04'),
            day('2026-06-05'),
        ];

        expect(
            recomputeHabitFromDays(days.slice(0, 4), '2026-06-04').streak,
        ).toBe(3);
        expect(recomputeHabitFromDays(days, '2026-06-05').streak).toBe(4);
    });

    it('restarts the goal streak after a frozen gap, re-arming freeze earning', () => {
        const days = [
            day('2026-06-01'),
            day('2026-06-02'),
            { ...day('2026-06-03', 0, false), frozen: true },
            day('2026-06-04'),
        ];

        const result = recomputeHabitFromDays(days, '2026-06-04');

        expect(result.streak).toBe(3);
        expect(result.goalStreak).toBe(1);
    });

    it('does not let a frozen day start or resurrect a run', () => {
        const result = recomputeHabitFromDays(
            [
                { ...day('2026-06-01', 0, false), frozen: true },
                { ...day('2026-06-03', 0, false), frozen: true },
                day('2026-06-04'),
            ],
            '2026-06-04',
        );

        expect(result.streak).toBe(1);
        expect(result.totalPracticeDays).toBe(1);
    });

    it('counts goal days and practice days separately', () => {
        const result = recomputeHabitFromDays(
            [
                day('2026-06-02', 10, true),
                day('2026-06-03', 2, false),
                { ...day('2026-06-04', 0, false), frozen: true },
                day('2026-06-05', 10, true),
            ],
            '2026-06-05',
        );

        expect(result.totalGoalDays).toBe(2);
        expect(result.totalPracticeDays).toBe(3);
    });

    it('ignores days where the goal was not met for the goal streak', () => {
        const result = recomputeHabitFromDays(
            [
                day('2026-06-03', 10, true),
                day('2026-06-04', 2, false),
                day('2026-06-05', 10, true),
            ],
            '2026-06-05',
        );

        expect(result.streak).toBe(3);
        expect(result.goalStreak).toBe(1);
        expect(result.longestGoalStreak).toBe(1);
        expect(result.lastGoalMetDate).toBe('2026-06-05');
    });
});

describe('bridgeableGap', () => {
    const base = {
        lastPracticeDate: '2026-06-01',
        resumeDate: '2026-06-04',
        streak: 45,
        freezes: 2,
    };

    it('covers every missed day when the bank can pay for them', () => {
        expect(bridgeableGap(base)).toEqual({
            dates: ['2026-06-02', '2026-06-03'],
            freezesConsumed: 2,
        });
    });

    it('bridges nothing when the gap outruns the bank', () => {
        expect(bridgeableGap({ ...base, freezes: 1 })).toEqual({
            dates: [],
            freezesConsumed: 0,
        });
    });

    it('bridges nothing when there is no gap', () => {
        expect(
            bridgeableGap({ ...base, resumeDate: '2026-06-02' }).dates,
        ).toEqual([]);
    });

    it('bridges nothing without a live streak, a bank, or a prior day', () => {
        expect(bridgeableGap({ ...base, streak: 0 }).freezesConsumed).toBe(0);
        expect(bridgeableGap({ ...base, freezes: 0 }).freezesConsumed).toBe(0);
        expect(
            bridgeableGap({ ...base, lastPracticeDate: null }).freezesConsumed,
        ).toBe(0);
    });
});

describe('reconcileFrozenGaps', () => {
    const day = (date: string) => ({ date, words: 10, goalMet: true });

    it('materializes the gap a stored streak implies but the ledger lacks', () => {
        // Written by the old code: the freeze was displayed, never recorded, so
        // the ledger shows a hole the stored streak of 5 cannot explain.
        const days = [
            day('2026-06-01'),
            day('2026-06-02'),
            day('2026-06-03'),
            // 06-04 missed, covered by a freeze at the time
            day('2026-06-05'),
            day('2026-06-06'),
        ];

        expect(reconcileFrozenGaps(days, 5)).toEqual({
            dates: ['2026-06-04'],
            freezesConsumed: 1,
        });
    });

    it('leaves a ledger that already explains the streak alone', () => {
        const days = [day('2026-06-01'), day('2026-06-02'), day('2026-06-03')];

        expect(reconcileFrozenGaps(days, 3)).toEqual({
            dates: [],
            freezesConsumed: 0,
        });
    });

    it('refuses to invent days for a streak wider gaps cannot justify', () => {
        const days = [day('2026-06-01'), day('2026-06-06')];

        expect(reconcileFrozenGaps(days, 5)).toEqual({
            dates: [],
            freezesConsumed: 0,
        });
    });

    it('does nothing for a streak of one or none', () => {
        const days = [day('2026-06-01'), day('2026-06-06')];

        expect(reconcileFrozenGaps(days, 1).dates).toEqual([]);
        expect(reconcileFrozenGaps(days, 0).dates).toEqual([]);
        expect(reconcileFrozenGaps([], 10).dates).toEqual([]);
    });
});

describe('mergePracticeDays', () => {
    it('sums duplicate dates and sorts ascending', () => {
        expect(
            mergePracticeDays([
                { clientDate: '2026-06-05', wordCount: 3 },
                { clientDate: '2026-06-03', wordCount: 4 },
                { clientDate: '2026-06-05', wordCount: 2 },
            ]),
        ).toEqual([
            { clientDate: '2026-06-03', wordCount: 4 },
            { clientDate: '2026-06-05', wordCount: 5 },
        ]);
    });
});
