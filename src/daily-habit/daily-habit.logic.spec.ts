import {
    addClientDays,
    bridgeableGap,
    effectiveGoalStreak,
    FREEZE_FIRST_EARN_GOAL_DAYS,
    HabitDayPoint,
    MAX_STREAK_FREEZES,
    effectivePracticeStreak,
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
    });
});

/**
 * The freeze economy, end to end over a ledger — the only place it is decided.
 * Balance starts at 0, caps at MAX_STREAK_FREEZES; the first freeze of a run
 * costs 3 consecutive goal-met days and every one after it costs 2.
 */
describe('the freeze earn cadence', () => {
    const goalDay = (date: string) => ({ date, words: 10, goalMet: true });
    const shortDay = (date: string) => ({ date, words: 4, goalMet: false });
    const frozenDay = (date: string) => ({
        date,
        words: 0,
        goalMet: false,
        frozen: true,
    });
    /** Consecutive goal-met days 2026-06-01 .. 2026-06-<count>. */
    const goalDays = (count: number) =>
        Array.from({ length: count }, (_, index) =>
            goalDay(addClientDays('2026-06-01', index)),
        );
    const freezesAfter = (days: HabitDayPoint[], clientDate: string) =>
        recomputeHabitFromDays(days, clientDate).freezes;

    it('banks nothing before the third goal-met day', () => {
        expect(freezesAfter(goalDays(2), '2026-06-02')).toBe(0);
        expect(
            recomputeHabitFromDays(goalDays(2), '2026-06-02')
                .goalDaysUntilNextFreeze,
        ).toBe(1);
    });

    it('earns the first freeze on the third goal-met day', () => {
        expect(freezesAfter(goalDays(3), '2026-06-03')).toBe(1);
    });

    it('earns the second freeze two goal-met days later', () => {
        expect(freezesAfter(goalDays(4), '2026-06-04')).toBe(1);
        expect(freezesAfter(goalDays(5), '2026-06-05')).toBe(2);
    });

    it('holds at the cap without banking progress', () => {
        const result = recomputeHabitFromDays(goalDays(20), '2026-06-20');

        expect(result.freezes).toBe(MAX_STREAK_FREEZES);
        expect(result.goalDaysUntilNextFreeze).toBeNull();
    });

    it('refills a spent freeze after exactly two goal-met days', () => {
        // Five days to a full bank, 06-06 missed and bridged, then back at it.
        const bridged = [
            ...goalDays(5),
            frozenDay('2026-06-06'),
            goalDay('2026-06-07'),
        ];

        expect(freezesAfter(bridged, '2026-06-07')).toBe(1);
        expect(
            recomputeHabitFromDays(bridged, '2026-06-07')
                .goalDaysUntilNextFreeze,
        ).toBe(1);
        expect(
            freezesAfter([...bridged, goalDay('2026-06-08')], '2026-06-08'),
        ).toBe(2);
    });

    it('re-arms at three days when the streak broke outright', () => {
        // One freeze banked, then a two-day gap nothing bridged: the run is
        // over, so the next freeze costs the first-earn price all over again.
        const broken = [
            ...goalDays(3),
            goalDay('2026-06-06'),
            goalDay('2026-06-07'),
        ];

        expect(freezesAfter(broken, '2026-06-07')).toBe(1);
        expect(
            freezesAfter([...broken, goalDay('2026-06-08')], '2026-06-08'),
        ).toBe(2);
    });

    it('spends one freeze per bridged day', () => {
        const twoDayGap = [
            ...goalDays(5),
            frozenDay('2026-06-06'),
            frozenDay('2026-06-07'),
            goalDay('2026-06-08'),
        ];

        expect(freezesAfter(twoDayGap, '2026-06-08')).toBe(0);
    });

    it('restarts the count when a practice day misses the goal', () => {
        const missedGoal = [
            ...goalDays(3),
            shortDay('2026-06-04'),
            goalDay('2026-06-05'),
            goalDay('2026-06-06'),
        ];

        // The 3-day run banked one; 06-04 broke the goal run, so 06-05/06-06
        // are a fresh pair — which is the repeat price, so the second lands.
        expect(freezesAfter(missedGoal, '2026-06-06')).toBe(2);
        // ...but a single goal-met day after the break is not enough.
        expect(freezesAfter(missedGoal.slice(0, -1), '2026-06-05')).toBe(1);
    });

    it('is idempotent: recomputing the same ledger twice agrees', () => {
        const days = [
            ...goalDays(5),
            frozenDay('2026-06-06'),
            goalDay('2026-06-07'),
            goalDay('2026-06-08'),
        ];

        expect(freezesAfter(days, '2026-06-08')).toBe(
            freezesAfter([...days], '2026-06-08'),
        );
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
            freezes: 0,
            goalDaysUntilNextFreeze: FREEZE_FIRST_EARN_GOAL_DAYS,
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
