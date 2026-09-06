import { DailyHabitService } from './daily-habit.service';
import { formatClientDate, parseClientDate } from './daily-habit-date.util';
import { MAX_STREAK_FREEZES } from './daily-habit.logic';

describe('DailyHabitService', () => {
    const userLoginId = '01936c1e-1234-7890-abcd-ef1234567890';
    const today = '2026-06-05';
    const yesterday = '2026-06-04';

    /** In-memory stand-in for the DailyHabitDay ledger the service recomputes from. */
    type DayRow = {
        practiceDate: Date;
        wordsPracticed: number;
        goalMet: boolean;
        /** Missed day paid for by a streak freeze. */
        frozen?: boolean;
    };

    let days: DayRow[];
    let habitRow: Record<string, unknown> | null;
    let grants: { practiceDate: Date; kind: string }[];

    let prisma: {
        dailyHabit: {
            findUnique: jest.Mock;
            update: jest.Mock;
            upsert: jest.Mock;
        };
        dailyHabitDay: {
            findMany: jest.Mock;
            update: jest.Mock;
            upsert: jest.Mock;
            createMany: jest.Mock;
            count: jest.Mock;
        };
        dailyHabitGrant: {
            findMany: jest.Mock;
            createMany: jest.Mock;
        };
        $transaction: jest.Mock;
    };
    let awardXp: jest.Mock;
    let detectAndUnlock: jest.Mock;
    let service: DailyHabitService;

    const findDay = (date: Date): DayRow | undefined =>
        days.find(
            (row) =>
                formatClientDate(row.practiceDate) === formatClientDate(date),
        );

    beforeEach(() => {
        days = [];
        grants = [];
        habitRow = null;

        prisma = {
            dailyHabit: {
                findUnique: jest.fn(() => Promise.resolve(habitRow)),
                update: jest.fn((args: { data: Record<string, unknown> }) => {
                    // Resolve Prisma { increment } writes so assertions can read
                    // the resulting row the way the service's callers do.
                    const next = { ...(habitRow ?? {}) } as Record<
                        string,
                        unknown
                    >;
                    for (const [key, value] of Object.entries(args.data)) {
                        if (
                            value &&
                            typeof value === 'object' &&
                            'increment' in value
                        ) {
                            next[key] =
                                ((next[key] as number) ?? 0) +
                                (value as { increment: number }).increment;
                        } else {
                            next[key] = value;
                        }
                    }
                    habitRow = next;
                    return Promise.resolve(next);
                }),
                upsert: jest.fn((args: { create: Record<string, unknown> }) => {
                    habitRow ??= {
                        dailyGoal: 10,
                        wordsToday: 0,
                        streak: 0,
                        longestStreak: 0,
                        goalStreak: 0,
                        longestGoalStreak: 0,
                        lastPracticeDate: null,
                        lastGoalMetDate: null,
                        totalWordsPracticed: 0,
                        totalPracticeDays: 0,
                        streakFreezes: 0,
                        lastFreezeUsedDate: null,
                        ...args.create,
                    };
                    return Promise.resolve(habitRow);
                }),
            },
            dailyHabitDay: {
                findMany: jest.fn(
                    (args?: { where?: { practiceDate?: { in?: Date[] } } }) => {
                        const filter = args?.where?.practiceDate?.in;
                        const rows = filter
                            ? days.filter((row) =>
                                  filter.some(
                                      (date) =>
                                          formatClientDate(date) ===
                                          formatClientDate(row.practiceDate),
                                  ),
                              )
                            : [...days].sort(
                                  (a, b) =>
                                      a.practiceDate.getTime() -
                                      b.practiceDate.getTime(),
                              );
                        return Promise.resolve(rows);
                    },
                ),
                upsert: jest.fn(
                    (args: {
                        where: {
                            userLoginId_practiceDate: { practiceDate: Date };
                        };
                        create: { wordsPracticed: number; goalMet: boolean };
                        update: { wordsPracticed: { increment: number } };
                    }) => {
                        const date =
                            args.where.userLoginId_practiceDate.practiceDate;
                        const existing = findDay(date);
                        if (existing) {
                            existing.wordsPracticed +=
                                args.update.wordsPracticed.increment;
                            // Real practice on a frozen day makes it a practice
                            // day again.
                            existing.frozen = false;
                            return Promise.resolve(existing);
                        }
                        const created: DayRow = {
                            practiceDate: date,
                            wordsPracticed: args.create.wordsPracticed,
                            goalMet: args.create.goalMet,
                            frozen: false,
                        };
                        days.push(created);
                        return Promise.resolve(created);
                    },
                ),
                createMany: jest.fn((args: { data: DayRow[] }) => {
                    const fresh = args.data.filter(
                        (row) => !findDay(row.practiceDate),
                    );
                    days.push(...fresh);
                    return Promise.resolve({ count: fresh.length });
                }),
                count: jest.fn(() =>
                    Promise.resolve(days.filter((row) => row.goalMet).length),
                ),
                update: jest.fn(
                    (args: {
                        where: {
                            userLoginId_practiceDate: { practiceDate: Date };
                        };
                        data: { goalMet: boolean };
                    }) => {
                        const row = findDay(
                            args.where.userLoginId_practiceDate.practiceDate,
                        );
                        if (row) {
                            row.goalMet = args.data.goalMet;
                        }
                        return Promise.resolve(row);
                    },
                ),
            },
            dailyHabitGrant: {
                findMany: jest.fn(
                    (args: { where: { practiceDate: { in: Date[] } } }) =>
                        Promise.resolve(
                            grants.filter((grant) =>
                                args.where.practiceDate.in.some(
                                    (date) =>
                                        formatClientDate(date) ===
                                        formatClientDate(grant.practiceDate),
                                ),
                            ),
                        ),
                ),
                createMany: jest.fn(
                    (args: {
                        data: { practiceDate: Date; kind: string }[];
                    }) => {
                        const fresh = args.data.filter(
                            (row) =>
                                !grants.some(
                                    (grant) =>
                                        grant.kind === row.kind &&
                                        formatClientDate(grant.practiceDate) ===
                                            formatClientDate(row.practiceDate),
                                ),
                        );
                        grants.push(...fresh);
                        return Promise.resolve({ count: fresh.length });
                    },
                ),
            },
            $transaction: jest.fn((fn: (tx: typeof prisma) => unknown) =>
                fn(prisma),
            ),
        };

        awardXp = jest.fn().mockResolvedValue({ leveledUp: false });
        detectAndUnlock = jest.fn().mockResolvedValue([]);

        service = new DailyHabitService(
            prisma as never,
            { awardXp } as never,
            { detectAndUnlock } as never,
            // SyncRequestService: no clientRequestId in most tests, so runOnce
            // just runs the work in a transaction.
            {
                runOnce: jest.fn(
                    (
                        _userLoginId: string,
                        _clientRequestId: string | undefined,
                        _endpoint: string,
                        work: (tx: unknown) => Promise<unknown>,
                    ) => prisma.$transaction(work) as unknown,
                ),
            } as never,
        );
    });

    it('returns empty state when no row exists', async () => {
        const result = await service.getDailyHabit(userLoginId, today);

        expect(result.wordsToday).toBe(0);
        expect(result.streak).toBe(0);
        expect(result.goal).toBe(10);
        expect(result.recentDays).toHaveLength(7);
    });

    it('creates a row and a day on first practice', async () => {
        const result = await service.recordPractice(userLoginId, {
            wordCount: 5,
            clientDate: today,
        });

        expect(prisma.dailyHabit.upsert).toHaveBeenCalled();
        expect(prisma.dailyHabitDay.upsert).toHaveBeenCalled();
        expect(result.wordsToday).toBe(5);
        expect(result.streak).toBe(1);
        expect(result.totalPracticeDays).toBe(1);
    });

    it('continues the streak when last practice was yesterday', async () => {
        days = [
            {
                practiceDate: parseClientDate('2026-06-03'),
                wordsPracticed: 10,
                goalMet: true,
            },
            {
                practiceDate: parseClientDate(yesterday),
                wordsPracticed: 10,
                goalMet: true,
            },
        ];
        habitRow = {
            dailyGoal: 10,
            wordsToday: 10,
            streak: 2,
            longestStreak: 2,
            goalStreak: 2,
            longestGoalStreak: 2,
            practiceDate: parseClientDate(yesterday),
            lastPracticeDate: parseClientDate(yesterday),
            lastGoalMetDate: parseClientDate(yesterday),
            totalWordsPracticed: 20,
            totalPracticeDays: 2,
            streakFreezes: 0,
            lastFreezeUsedDate: null,
        };

        const result = await service.recordPractice(userLoginId, {
            wordCount: 3,
            clientDate: today,
        });

        expect(result.streak).toBe(3);
        expect(result.wordsToday).toBe(3);
    });

    it('keeps practiceDate on today and wordsToday from the ledger when only backdated days arrive', async () => {
        // Regression test: a backdated call used to overwrite practiceDate with
        // the older date and replace wordsToday with the backdated count.
        days = [
            {
                practiceDate: parseClientDate(today),
                wordsPracticed: 8,
                goalMet: false,
            },
        ];
        habitRow = {
            dailyGoal: 10,
            wordsToday: 8,
            streak: 1,
            longestStreak: 1,
            goalStreak: 0,
            longestGoalStreak: 0,
            practiceDate: parseClientDate(today),
            lastPracticeDate: parseClientDate(today),
            lastGoalMetDate: null,
            totalWordsPracticed: 8,
            totalPracticeDays: 1,
            streakFreezes: 0,
            lastFreezeUsedDate: null,
        };

        const result = await service.recordPracticeBatch(userLoginId, {
            days: [{ clientDate: '2026-06-02', wordCount: 6 }],
            clientDate: today,
        });

        expect(result.wordsToday).toBe(8);
        expect(formatClientDate(habitRow.practiceDate as Date)).toBe(today);
        expect(result.totalWordsPracticed).toBe(14);
    });

    it('joins two runs when a backdated day fills the gap', async () => {
        // 06-01, 06-02, [gap 06-03], 06-04, 06-05 -> filling 06-03 makes it 5.
        days = [
            {
                practiceDate: parseClientDate('2026-06-01'),
                wordsPracticed: 10,
                goalMet: true,
            },
            {
                practiceDate: parseClientDate('2026-06-02'),
                wordsPracticed: 10,
                goalMet: true,
            },
            {
                practiceDate: parseClientDate(yesterday),
                wordsPracticed: 10,
                goalMet: true,
            },
            {
                practiceDate: parseClientDate(today),
                wordsPracticed: 10,
                goalMet: true,
            },
        ];
        habitRow = {
            dailyGoal: 10,
            wordsToday: 10,
            streak: 2,
            longestStreak: 2,
            goalStreak: 2,
            longestGoalStreak: 2,
            practiceDate: parseClientDate(today),
            lastPracticeDate: parseClientDate(today),
            lastGoalMetDate: parseClientDate(today),
            totalWordsPracticed: 40,
            totalPracticeDays: 4,
            streakFreezes: 0,
            lastFreezeUsedDate: null,
        };

        const result = await service.recordPracticeBatch(userLoginId, {
            days: [{ clientDate: '2026-06-03', wordCount: 10 }],
            clientDate: today,
        });

        expect(result.streak).toBe(5);
        expect(result.longestStreak).toBe(5);
    });

    it('increments totalPracticeDays only for dates with no prior day row', async () => {
        days = [
            {
                practiceDate: parseClientDate(yesterday),
                wordsPracticed: 4,
                goalMet: false,
            },
        ];
        habitRow = {
            dailyGoal: 10,
            wordsToday: 4,
            streak: 1,
            longestStreak: 1,
            goalStreak: 0,
            longestGoalStreak: 0,
            practiceDate: parseClientDate(yesterday),
            lastPracticeDate: parseClientDate(yesterday),
            lastGoalMetDate: null,
            totalWordsPracticed: 4,
            totalPracticeDays: 1,
            streakFreezes: 0,
            lastFreezeUsedDate: null,
        };

        const result = await service.recordPracticeBatch(userLoginId, {
            days: [
                { clientDate: yesterday, wordCount: 2 },
                { clientDate: today, wordCount: 5 },
            ],
            clientDate: today,
        });

        expect(result.totalPracticeDays).toBe(2);
    });

    it('never lowers longestStreak when the recompute yields a shorter run', async () => {
        days = [
            {
                practiceDate: parseClientDate(today),
                wordsPracticed: 5,
                goalMet: false,
            },
        ];
        habitRow = {
            dailyGoal: 10,
            wordsToday: 5,
            streak: 1,
            longestStreak: 42,
            goalStreak: 0,
            longestGoalStreak: 17,
            practiceDate: parseClientDate(today),
            lastPracticeDate: parseClientDate(today),
            lastGoalMetDate: null,
            totalWordsPracticed: 500,
            totalPracticeDays: 60,
            streakFreezes: 0,
            lastFreezeUsedDate: null,
        };

        const result = await service.recordPracticeBatch(userLoginId, {
            days: [{ clientDate: today, wordCount: 1 }],
            clientDate: today,
        });

        expect(result.longestStreak).toBe(42);
        expect(result.longestGoalStreak).toBe(17);
    });

    it('grants per-day consistency XP only once, even across separate flushes', async () => {
        await service.recordPracticeBatch(userLoginId, {
            days: [{ clientDate: today, wordCount: 10 }],
            clientDate: today,
        });

        // First practice of the day (10) + goal met (15).
        expect(awardXp).toHaveBeenLastCalledWith(
            expect.anything(),
            userLoginId,
            25,
        );

        awardXp.mockClear();

        // A different flush covering the same day: words still count, but the
        // one-shot grants must not pay again.
        await service.recordPracticeBatch(userLoginId, {
            days: [{ clientDate: today, wordCount: 10 }],
            clientDate: today,
        });

        expect(awardXp).not.toHaveBeenCalled();
        expect(habitRow!.totalWordsPracticed).toBe(20);
    });

    describe('streak freezes', () => {
        /** A long unbroken run of goal-met days ending on `end`. */
        const runEndingOn = (end: string, length: number): DayRow[] =>
            Array.from({ length }, (_, index) => ({
                practiceDate: parseClientDate(
                    formatClientDate(
                        new Date(
                            parseClientDate(end).getTime() -
                                (length - 1 - index) * 86_400_000,
                        ),
                    ),
                ),
                wordsPracticed: 10,
                goalMet: true,
                frozen: false,
            }));

        const habitAfterRun = (
            end: string,
            streak: number,
            freezes: number,
        ): Record<string, unknown> => ({
            dailyGoal: 10,
            wordsToday: 10,
            streak,
            longestStreak: streak,
            goalStreak: streak,
            longestGoalStreak: streak,
            practiceDate: parseClientDate(end),
            lastPracticeDate: parseClientDate(end),
            lastGoalMetDate: parseClientDate(end),
            totalWordsPracticed: streak * 10,
            totalPracticeDays: streak,
            totalGoalDays: streak,
            streakFreezes: freezes,
            lastFreezeUsedDate: null,
        });

        it('spends the freezes and grows the streak when the user comes back', async () => {
            // The reported bug: 45-day streak, two missed days covered by the two
            // banked freezes, then a session. The streak used to stick at 45 and
            // the balance used to snap back to 2/2.
            days = runEndingOn('2026-06-02', 45);
            habitRow = habitAfterRun('2026-06-02', 45, 2);

            const result = await service.recordPracticeBatch(userLoginId, {
                days: [{ clientDate: today, wordCount: 10 }],
                clientDate: today,
            });

            expect(result.streak).toBe(46);
            expect(result.longestStreak).toBe(46);
            expect(result.streakFreezes).toBe(0);
            expect(result.streakShielded).toBe(false);
            // The goal run restarts, so the next freeze must be re-earned.
            expect(result.goalStreak).toBe(1);
            // The missed days are recorded as frozen, not as practice.
            expect(result.totalPracticeDays).toBe(46);
            expect(days.filter((day) => day.frozen)).toHaveLength(2);
        });

        it('keeps counting up on the days after the freeze was spent', async () => {
            days = [
                ...runEndingOn('2026-06-02', 45),
                {
                    practiceDate: parseClientDate('2026-06-03'),
                    wordsPracticed: 0,
                    goalMet: false,
                    frozen: true,
                },
                {
                    practiceDate: parseClientDate(yesterday),
                    wordsPracticed: 10,
                    goalMet: true,
                    frozen: false,
                },
            ];
            habitRow = {
                ...habitAfterRun(yesterday, 46, 0),
                longestStreak: 46,
                goalStreak: 1,
                longestGoalStreak: 45,
            };

            const result = await service.recordPracticeBatch(userLoginId, {
                days: [{ clientDate: today, wordCount: 10 }],
                clientDate: today,
            });

            expect(result.streak).toBe(47);
            expect(result.goalStreak).toBe(2);
        });

        it('refills a spent freeze after two consecutive goal days', async () => {
            days = [
                ...runEndingOn('2026-06-01', 45),
                {
                    practiceDate: parseClientDate('2026-06-02'),
                    wordsPracticed: 0,
                    goalMet: false,
                    frozen: true,
                },
                {
                    practiceDate: parseClientDate('2026-06-03'),
                    wordsPracticed: 10,
                    goalMet: true,
                    frozen: false,
                },
                {
                    practiceDate: parseClientDate(yesterday),
                    wordsPracticed: 10,
                    goalMet: true,
                    frozen: false,
                },
            ];
            habitRow = {
                ...habitAfterRun(yesterday, 47, 0),
                goalStreak: 2,
                longestGoalStreak: 45,
            };

            const result = await service.recordPracticeBatch(userLoginId, {
                days: [{ clientDate: today, wordCount: 10 }],
                clientDate: today,
            });

            expect(result.goalStreak).toBe(3);
            // 06-03 and 06-04 already paid the repeat price and refilled the
            // freeze the frozen 06-02 spent; today tops the bank back up to the
            // cap. The run never broke, so this never costs a fresh three days.
            expect(result.streakFreezes).toBe(MAX_STREAK_FREEZES);
        });

        it('lapses the streak when the gap outruns the bank', async () => {
            // Three missed days, one freeze: nothing is bridged, nothing spent.
            days = runEndingOn('2026-06-01', 45);
            habitRow = habitAfterRun('2026-06-01', 45, 1);

            const result = await service.recordPracticeBatch(userLoginId, {
                days: [{ clientDate: today, wordCount: 10 }],
                clientDate: today,
            });

            expect(result.streak).toBe(1);
            expect(result.longestStreak).toBe(45);
            // Nothing was bridged, so nothing was spent — and the balance is
            // read from the ledger, where the 45-day run long ago filled the
            // bank. The stored 1 was a legacy value the ledger cannot justify.
            expect(result.streakFreezes).toBe(MAX_STREAK_FREEZES);
            expect(days.some((day) => day.frozen)).toBe(false);
        });

        it('repairs a row whose stored streak the ledger cannot explain', async () => {
            // Written by the old code: the freeze was displayed but never
            // recorded, so the ledger has a hole and the stored streak was
            // pinned at 45 by the removed Math.max floor.
            days = [
                ...runEndingOn('2026-06-01', 43),
                // 06-02 missed, covered by a freeze that was never debited
                {
                    practiceDate: parseClientDate('2026-06-03'),
                    wordsPracticed: 10,
                    goalMet: true,
                    frozen: false,
                },
                {
                    practiceDate: parseClientDate(yesterday),
                    wordsPracticed: 10,
                    goalMet: true,
                    frozen: false,
                },
            ];
            habitRow = habitAfterRun(yesterday, 45, 2);

            // Under the goal today, so today itself cannot earn anything.
            const result = await service.recordPracticeBatch(userLoginId, {
                days: [{ clientDate: today, wordCount: 3 }],
                clientDate: today,
            });

            expect(result.streak).toBe(46);
            // The hole is now a frozen day — a real debit — which 06-03 and
            // 06-04 then refilled at the repeat price.
            expect(result.streakFreezes).toBe(MAX_STREAK_FREEZES);
            expect(days.filter((day) => day.frozen)).toHaveLength(1);
        });

        it('walks the whole economy one session at a time', async () => {
            // The learner-facing contract, day by day: 0 to start, +1 on the
            // third goal day, +1 two days later, a missed day spends one, and
            // two more goal days put it back at the cap.
            const balanceAfterPracticeOn = async (
                clientDate: string,
            ): Promise<number> =>
                (
                    await service.recordPractice(userLoginId, {
                        wordCount: 10,
                        clientDate,
                    })
                ).streakFreezes;

            const banked: number[] = [];
            for (const date of ['06-01', '06-02', '06-03', '06-04', '06-05']) {
                banked.push(await balanceAfterPracticeOn(`2026-${date}`));
            }
            expect(banked).toEqual([0, 0, 1, 1, 2]);

            // 2026-06-06 missed: the next session bridges it with a freeze,
            // and the two goal days that follow put the balance back at 2.
            expect(await balanceAfterPracticeOn('2026-06-07')).toBe(1);
            expect(await balanceAfterPracticeOn('2026-06-08')).toBe(2);

            expect(
                days
                    .filter((day) => day.frozen)
                    .map((day) => formatClientDate(day.practiceDate)),
            ).toEqual(['2026-06-06']);
        });

        it('does not double-earn when a flush is replayed', async () => {
            for (const date of ['06-01', '06-02', '06-03']) {
                await service.recordPractice(userLoginId, {
                    wordCount: 10,
                    clientDate: `2026-${date}`,
                });
            }

            // Same day again — a retry, or a second session that day.
            const result = await service.recordPractice(userLoginId, {
                wordCount: 10,
                clientDate: '2026-06-03',
            });

            expect(result.streakFreezes).toBe(1);
        });

        it('reports both total goal days and total practice days', async () => {
            days = [
                {
                    practiceDate: parseClientDate(yesterday),
                    wordsPracticed: 3,
                    goalMet: false,
                    frozen: false,
                },
            ];
            habitRow = {
                ...habitAfterRun(yesterday, 1, 0),
                goalStreak: 0,
                longestGoalStreak: 0,
                lastGoalMetDate: null,
                totalGoalDays: 0,
                totalPracticeDays: 1,
            };

            const result = await service.recordPracticeBatch(userLoginId, {
                days: [{ clientDate: today, wordCount: 10 }],
                clientDate: today,
            });

            expect(result.totalPracticeDays).toBe(2);
            expect(result.totalGoalDays).toBe(1);
        });
    });

    it('rejects a practice day in the future', async () => {
        await expect(
            service.recordPracticeBatch(userLoginId, {
                days: [{ clientDate: '2026-06-09', wordCount: 3 }],
                clientDate: today,
            }),
        ).rejects.toThrow(/future/i);
    });

    it('detects achievements after the habit row is written', async () => {
        await service.recordPractice(userLoginId, {
            wordCount: 5,
            clientDate: today,
        });

        const updateOrder =
            prisma.dailyHabit.update.mock.invocationCallOrder[0];
        const detectOrder = detectAndUnlock.mock.invocationCallOrder[0];
        expect(detectOrder).toBeGreaterThan(updateOrder);
    });
});
