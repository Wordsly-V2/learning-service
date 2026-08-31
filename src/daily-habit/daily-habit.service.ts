import { PrismaService } from '@/prisma/prisma.service';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DailyHabit, DailyHabitDay, Prisma } from '@prisma/client';
import {
    ACTIVITY_HISTORY_DAYS,
    BatchRecordDailyPracticeDto,
    DAILY_GOAL_WORDS,
    DailyHabitDayDto,
    DailyHabitResponseDto,
    MAX_BACKDATED_HABIT_DAYS,
    RecordDailyPracticeDto,
    UpdateDailyGoalDto,
} from './dto/daily-habit.dto';
import {
    datesEqual,
    formatClientDate,
    parseClientDate,
    yesterdayClientDate,
} from './daily-habit-date.util';
import {
    addClientDays,
    bridgeableGap,
    effectiveGoalStreak,
    freezesAfterPractice,
    habitMotivation,
    HabitDayPoint,
    isGoalMet,
    isStreakAtRisk,
    lastNDays,
    mergePracticeDays,
    nextGoalStreak,
    nextStreakMilestone,
    reconcileFrozenGaps,
    recomputeHabitFromDays,
    resolveDisplayStreak,
} from './daily-habit.logic';
import { UserLevelService } from '@/user-level/user-level.service';
import {
    XP_DAILY_GOAL_MET,
    XP_FIRST_PRACTICE_OF_DAY,
} from '@/user-level/user-level.logic';
import { AchievementService } from '@/achievement/achievement.service';
import { UnlockedAchievementDto } from '@/achievement/dto/achievement.dto';
import {
    SYNC_ENDPOINT_HABIT_BATCH,
    SyncRequestService,
} from '@/sync/sync-request.service';

type DailyHabitRow = DailyHabit & { days?: DailyHabitDay[] };

/** DailyHabitGrant.kind values — one-shot per-day consistency XP. */
const GRANT_FIRST_PRACTICE = 'first-practice';
const GRANT_GOAL_MET = 'goal-met';

@Injectable()
export class DailyHabitService {
    private readonly logger = new Logger(DailyHabitService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly userLevelService: UserLevelService,
        private readonly achievementService: AchievementService,
        private readonly syncRequests: SyncRequestService,
    ) {}

    async getDailyHabit(
        userLoginId: string,
        clientDate: string,
    ): Promise<DailyHabitResponseDto> {
        const row = await this.prisma.dailyHabit.findUnique({
            where: { userLoginId },
        });
        const recentDays = await this.loadRecentDays(userLoginId, clientDate);
        return this.toResponse(row, clientDate, recentDays);
    }

    /**
     * Record one session. Delegates to the batch path so the online and offline
     * flows can never drift apart.
     */
    async recordPractice(
        userLoginId: string,
        body: RecordDailyPracticeDto,
    ): Promise<DailyHabitResponseDto> {
        return this.recordPracticeBatch(userLoginId, {
            days: [{ clientDate: body.clientDate, wordCount: body.wordCount }],
            clientDate: body.clientDate,
        });
    }

    /**
     * Record practice for one or more calendar days at once.
     *
     * An offline client can hold several days of sessions, so days arrive late and
     * out of order. Two things make that safe:
     *
     * - `practiceDate` and `wordsToday` always describe the client's TODAY, read
     *   back from the per-day ledger. Previously a backdated call overwrote both
     *   with the older date and destroyed today's count.
     * - Streaks are recomputed from the whole `DailyHabitDay` history rather than
     *   advanced from a single cursor, so a backdated day that fills a gap joins
     *   two runs instead of being silently absorbed.
     * - A gap a banked freeze pays for is WRITTEN to that history as frozen days
     *   (see materializeFrozenDays) before the recompute runs, so the bridge is
     *   part of the ledger rather than a display-time illusion. The recompute is
     *   then authoritative: no flooring against the stored streak, which used to
     *   pin the number at its stale value forever.
     */
    async recordPracticeBatch(
        userLoginId: string,
        body: BatchRecordDailyPracticeDto,
    ): Promise<DailyHabitResponseDto> {
        const clientToday = body.clientDate;
        const today = parseClientDate(clientToday);

        const merged = mergePracticeDays(body.days);
        if (merged.some((day) => day.clientDate > clientToday)) {
            throw new BadRequestException(
                'Practice day cannot be in the future',
            );
        }

        const floor = addClientDays(clientToday, -MAX_BACKDATED_HABIT_DAYS);
        const usable = merged.filter((day) => day.clientDate >= floor);
        if (usable.length === 0) {
            const recentDays = await this.loadRecentDays(
                userLoginId,
                clientToday,
            );
            const row = await this.prisma.dailyHabit.findUnique({
                where: { userLoginId },
            });
            return this.toResponse(row, clientToday, recentDays);
        }
        if (usable.length < merged.length) {
            this.logger.warn('dropped ancient practice days', {
                userLoginId,
                dropped: merged.length - usable.length,
            });
        }

        const totalWords = usable.reduce((sum, day) => sum + day.wordCount, 0);

        const { row: updated, unlockedAchievements } =
            await this.syncRequests.runOnce<{
                row: DailyHabit;
                unlockedAchievements: UnlockedAchievementDto[];
            }>(
                userLoginId,
                body.clientRequestId,
                SYNC_ENDPOINT_HABIT_BATCH,
                async (tx) => {
                    // DailyHabitDay has an FK to DailyHabit, so the parent row has
                    // to exist before any day row.
                    const existing = await tx.dailyHabit.upsert({
                        where: { userLoginId },
                        create: {
                            userLoginId,
                            dailyGoal: DAILY_GOAL_WORDS,
                            practiceDate: today,
                        },
                        update: {},
                    });
                    const dailyGoal = existing.dailyGoal;

                    const daysBefore = await this.loadLedger(tx, userLoginId);
                    // The goal streak as it stood BEFORE this batch — the baseline
                    // freeze earning is measured against. The stored goalStreak
                    // can't be used: it is stale after a gap, so a threshold
                    // crossing would never be detected.
                    const goalStreakBefore = recomputeHabitFromDays(
                        daysBefore,
                        clientToday,
                    ).goalStreak;

                    const freezesConsumed = await this.materializeFrozenDays(
                        tx,
                        userLoginId,
                        daysBefore,
                        existing,
                        usable.map((day) => day.clientDate),
                    );

                    // Which of these dates are brand new? Drives totalPracticeDays,
                    // which stays increment-only. A frozen row is not practice, so
                    // practicing on one still counts as a new practice day.
                    const priorDays = await tx.dailyHabitDay.findMany({
                        where: {
                            userLoginId,
                            practiceDate: {
                                in: usable.map((day) =>
                                    parseClientDate(day.clientDate),
                                ),
                            },
                        },
                        select: { practiceDate: true, frozen: true },
                    });
                    const priorDates = new Set(
                        priorDays
                            .filter((row) => !row.frozen)
                            .map((row) => formatClientDate(row.practiceDate)),
                    );
                    const newDayCount = usable.filter(
                        (day) => !priorDates.has(day.clientDate),
                    ).length;

                    for (const day of usable) {
                        const practiceDate = parseClientDate(day.clientDate);
                        const dayRow = await tx.dailyHabitDay.upsert({
                            where: {
                                userLoginId_practiceDate: {
                                    userLoginId,
                                    practiceDate,
                                },
                            },
                            create: {
                                userLoginId,
                                practiceDate,
                                wordsPracticed: day.wordCount,
                                goalMet: isGoalMet(day.wordCount, dailyGoal),
                            },
                            update: {
                                wordsPracticed: { increment: day.wordCount },
                                // Real practice landed on a day a freeze had
                                // covered — it is a practice day again.
                                frozen: false,
                            },
                        });

                        const goalMet = isGoalMet(
                            dayRow.wordsPracticed,
                            dailyGoal,
                        );
                        if (dayRow.goalMet !== goalMet) {
                            await tx.dailyHabitDay.update({
                                where: {
                                    userLoginId_practiceDate: {
                                        userLoginId,
                                        practiceDate,
                                    },
                                },
                                data: { goalMet },
                            });
                        }
                    }

                    const allDays = await this.loadLedger(tx, userLoginId);
                    const recomputed = recomputeHabitFromDays(
                        allDays,
                        clientToday,
                    );

                    // The ledger is authoritative for the current streak: a
                    // freeze-bridged gap is now recorded as frozen days, so the
                    // recompute reconstructs it. Flooring against the stored
                    // streak instead (as this used to) pinned the number at its
                    // stale value — it could never grow again.
                    //
                    // `longest*` never decreasing is still the invariant that
                    // keeps out-of-order ingestion from wrongly skipping an
                    // achievement: totals only ever rise, so a milestone crossed
                    // by a late batch is still detected.
                    const streak = recomputed.streak;
                    const longestStreak = Math.max(
                        existing.longestStreak,
                        recomputed.longestStreak,
                        streak,
                    );
                    const goalStreak = Math.max(
                        recomputed.goalStreak,
                        effectiveGoalStreak(
                            existing.goalStreak,
                            existing.lastGoalMetDate,
                            clientToday,
                        ),
                    );
                    const longestGoalStreak = Math.max(
                        existing.longestGoalStreak,
                        recomputed.longestGoalStreak,
                        goalStreak,
                    );

                    await this.grantDailyConsistencyXp(
                        tx,
                        userLoginId,
                        usable.map((day) => day.clientDate),
                        dailyGoal,
                        allDays,
                    );

                    const row = await tx.dailyHabit.update({
                        where: { userLoginId },
                        data: {
                            // From the ledger, so a backdated day can no longer
                            // overwrite today's count.
                            wordsToday: recomputed.wordsToday,
                            // ALWAYS the client's today.
                            practiceDate: today,
                            streak,
                            longestStreak,
                            goalStreak,
                            longestGoalStreak,
                            lastPracticeDate: recomputed.lastPracticeDate
                                ? parseClientDate(recomputed.lastPracticeDate)
                                : null,
                            lastGoalMetDate: recomputed.lastGoalMetDate
                                ? parseClientDate(recomputed.lastGoalMetDate)
                                : null,
                            streakFreezes: freezesAfterPractice({
                                currentFreezes: existing.streakFreezes,
                                // Debit whatever the gap this session closed
                                // actually cost (0 when nothing was bridged).
                                freezesConsumed,
                                // Baseline from the ledger, not the stored value:
                                // after a bridged gap the goal run restarts at 1,
                                // which is what re-arms the 3-/5-day thresholds.
                                prevGoalStreak: goalStreakBefore,
                                newGoalStreak: goalStreak,
                                goalMetToday: isGoalMet(
                                    recomputed.wordsToday,
                                    dailyGoal,
                                ),
                            }),
                            totalGoalDays: recomputed.totalGoalDays,
                            totalWordsPracticed: { increment: totalWords },
                            ...(newDayCount > 0 && {
                                totalPracticeDays: { increment: newDayCount },
                            }),
                            ...(freezesConsumed > 0 && {
                                lastFreezeUsedDate: today,
                            }),
                        },
                    });

                    // After the update so a freeze reward is capped against the
                    // just-written streakFreezes.
                    const unlocked =
                        await this.achievementService.detectAndUnlock(
                            tx,
                            userLoginId,
                            {
                                longestStreak: row.longestStreak,
                                totalWordsPracticed: row.totalWordsPracticed,
                                totalPracticeDays: row.totalPracticeDays,
                            },
                        );
                    return { row, unlockedAchievements: unlocked };
                },
            );

        const recentDays = await this.loadRecentDays(userLoginId, clientToday);
        return {
            ...this.toResponse(updated, clientToday, recentDays),
            unlockedAchievements,
        };
    }

    /** The whole per-day ledger, ascending, as logic-layer points. */
    private async loadLedger(
        tx: Prisma.TransactionClient,
        userLoginId: string,
    ): Promise<HabitDayPoint[]> {
        const rows = await tx.dailyHabitDay.findMany({
            where: { userLoginId },
            select: {
                practiceDate: true,
                wordsPracticed: true,
                goalMet: true,
                frozen: true,
            },
            orderBy: { practiceDate: 'asc' },
        });
        return rows.map((row) => ({
            date: formatClientDate(row.practiceDate),
            words: row.wordsPracticed,
            goalMet: row.goalMet,
            frozen: row.frozen,
        }));
    }

    /**
     * Write the freeze-covered days this session is about to bridge, and report
     * what they cost.
     *
     * A freeze only ever protected the streak on the read path before — nothing
     * recorded it — so the next recompute lapsed the streak and the balance
     * silently snapped back to full. Recording the bridge as `frozen` day rows
     * fixes both: the chain survives the recompute, and the freezes are debited.
     *
     * Two gaps can need covering: the one this session is returning across, and
     * (once, for rows written before this existed) an unexplained older gap the
     * stored streak implies. Both are capped by the banked balance.
     */
    private async materializeFrozenDays(
        tx: Prisma.TransactionClient,
        userLoginId: string,
        daysBefore: HabitDayPoint[],
        existing: DailyHabit,
        batchDates: string[],
    ): Promise<number> {
        const lastPracticeDate = existing.lastPracticeDate
            ? formatClientDate(existing.lastPracticeDate)
            : null;

        // Repair first, so the returning gap is measured against a ledger that
        // already explains the stored streak.
        const repair = reconcileFrozenGaps(daysBefore, existing.streak);

        // The day practice resumes on: the earliest day in this batch after the
        // last recorded practice. Backdated days that fall before it fill gaps
        // for real and need no freeze.
        const resumeDate = batchDates
            .filter(
                (date) => lastPracticeDate === null || date > lastPracticeDate,
            )
            .sort()[0];
        const gap = resumeDate
            ? bridgeableGap({
                  lastPracticeDate,
                  resumeDate,
                  streak: existing.streak,
                  freezes: Math.max(
                      0,
                      existing.streakFreezes - repair.freezesConsumed,
                  ),
              })
            : { dates: [], freezesConsumed: 0 };

        const dates = [...repair.dates, ...gap.dates];
        if (dates.length === 0) {
            return 0;
        }

        await tx.dailyHabitDay.createMany({
            data: dates.map((date) => ({
                userLoginId,
                practiceDate: parseClientDate(date),
                wordsPracticed: 0,
                goalMet: false,
                frozen: true,
            })),
            skipDuplicates: true,
        });

        // Never debit more than the user actually banked.
        return Math.min(
            existing.streakFreezes,
            repair.freezesConsumed + gap.freezesConsumed,
        );
    }

    /**
     * Award "first practice of the day" and "daily goal met" XP, once per day
     * ever. The `DailyHabitGrant` primary key is the guarantee: a replayed flush,
     * a backdated day arriving late, or two devices racing can each pay for a
     * given day at most once.
     */
    private async grantDailyConsistencyXp(
        tx: Prisma.TransactionClient,
        userLoginId: string,
        dates: string[],
        dailyGoal: number,
        history: HabitDayPoint[],
    ): Promise<void> {
        const goalMetByDate = new Map(
            history.map((day) => [day.date, isGoalMet(day.words, dailyGoal)]),
        );

        const candidates: {
            practiceDate: string;
            kind: string;
            xpAwarded: number;
        }[] = [];
        for (const date of dates) {
            candidates.push({
                practiceDate: date,
                kind: GRANT_FIRST_PRACTICE,
                xpAwarded: XP_FIRST_PRACTICE_OF_DAY,
            });
            if (goalMetByDate.get(date)) {
                candidates.push({
                    practiceDate: date,
                    kind: GRANT_GOAL_MET,
                    xpAwarded: XP_DAILY_GOAL_MET,
                });
            }
        }
        if (candidates.length === 0) {
            return;
        }

        const alreadyGranted = await tx.dailyHabitGrant.findMany({
            where: {
                userLoginId,
                practiceDate: { in: dates.map(parseClientDate) },
            },
            select: { practiceDate: true, kind: true },
        });
        const grantedKeys = new Set(
            alreadyGranted.map(
                (row) => `${formatClientDate(row.practiceDate)}|${row.kind}`,
            ),
        );

        const missing = candidates.filter(
            (candidate) =>
                !grantedKeys.has(`${candidate.practiceDate}|${candidate.kind}`),
        );
        if (missing.length === 0) {
            return;
        }

        const inserted = await tx.dailyHabitGrant.createMany({
            data: missing.map((candidate) => ({
                userLoginId,
                practiceDate: parseClientDate(candidate.practiceDate),
                kind: candidate.kind,
                xpAwarded: candidate.xpAwarded,
            })),
            skipDuplicates: true,
        });
        if (inserted.count === 0) {
            return;
        }

        // Only pay for rows this call actually inserted. When skipDuplicates
        // dropped some, pay the cheapest subset rather than over-crediting.
        const sorted = [...missing].sort((a, b) => a.xpAwarded - b.xpAwarded);
        const xp = sorted
            .slice(0, inserted.count)
            .reduce((sum, candidate) => sum + candidate.xpAwarded, 0);
        await this.userLevelService.awardXp(tx, userLoginId, xp);
    }

    async updateDailyGoal(
        userLoginId: string,
        body: UpdateDailyGoalDto,
        clientDate: string,
    ): Promise<DailyHabitResponseDto> {
        const today = parseClientDate(clientDate);
        const row = await this.prisma.dailyHabit.upsert({
            where: { userLoginId },
            create: {
                userLoginId,
                dailyGoal: body.dailyGoal,
                practiceDate: today,
            },
            update: {
                dailyGoal: body.dailyGoal,
            },
        });

        const todayDay = await this.prisma.dailyHabitDay.findUnique({
            where: {
                userLoginId_practiceDate: {
                    userLoginId,
                    practiceDate: today,
                },
            },
        });

        if (todayDay) {
            const goalMet = isGoalMet(todayDay.wordsPracticed, body.dailyGoal);
            if (todayDay.goalMet !== goalMet) {
                await this.prisma.dailyHabitDay.update({
                    where: {
                        userLoginId_practiceDate: {
                            userLoginId,
                            practiceDate: today,
                        },
                    },
                    data: { goalMet },
                });
            }

            const yesterday = parseClientDate(yesterdayClientDate(clientDate));
            const goalUpdate = nextGoalStreak(
                row.goalStreak,
                row.lastGoalMetDate,
                today,
                yesterday,
                goalMet,
            );
            const longestGoalStreak = Math.max(
                row.longestGoalStreak,
                goalUpdate.goalStreak,
            );

            const streakFreezes = freezesAfterPractice({
                currentFreezes: row.streakFreezes,
                freezesConsumed: 0,
                prevGoalStreak: row.goalStreak,
                newGoalStreak: goalUpdate.goalStreak,
                goalMetToday: goalMet,
            });

            // A new goal can flip today's goalMet either way, so the total is
            // re-derived rather than incremented.
            const totalGoalDays = await this.prisma.dailyHabitDay.count({
                where: { userLoginId, goalMet: true },
            });

            const updated = await this.prisma.dailyHabit.update({
                where: { userLoginId },
                data: {
                    dailyGoal: body.dailyGoal,
                    goalStreak: goalUpdate.goalStreak,
                    longestGoalStreak,
                    lastGoalMetDate: goalUpdate.lastGoalMetDate,
                    streakFreezes,
                    totalGoalDays,
                },
            });
            const recentDays = await this.loadRecentDays(
                userLoginId,
                clientDate,
            );
            return this.toResponse(updated, clientDate, recentDays);
        }

        const recentDays = await this.loadRecentDays(userLoginId, clientDate);
        return this.toResponse(row, clientDate, recentDays);
    }

    private async loadRecentDays(
        userLoginId: string,
        clientDate: string,
    ): Promise<DailyHabitDayDto[]> {
        const dates = lastNDays(clientDate, ACTIVITY_HISTORY_DAYS);
        const start = parseClientDate(dates[0]);
        const end = parseClientDate(dates[dates.length - 1]);

        const rows = await this.prisma.dailyHabitDay.findMany({
            where: {
                userLoginId,
                practiceDate: { gte: start, lte: end },
            },
        });

        const byDate = new Map(
            rows.map((row) => [formatClientDate(row.practiceDate), row]),
        );

        return dates.map((date) => {
            const row = byDate.get(date);
            return {
                date,
                words: row?.wordsPracticed ?? 0,
                goalMet: row?.goalMet ?? false,
                frozen: row?.frozen ?? false,
            };
        });
    }

    private toResponse(
        row: DailyHabitRow | null,
        clientDate: string,
        recentDays: DailyHabitDayDto[],
    ): DailyHabitResponseDto {
        const today = parseClientDate(clientDate);
        const goal = row?.dailyGoal ?? DAILY_GOAL_WORDS;

        if (!row) {
            return this.emptyResponse(clientDate, goal, recentDays);
        }

        const sameDay = datesEqual(row.practiceDate, today);
        const wordsToday = sameDay ? row.wordsToday : 0;
        const goalMetToday = isGoalMet(wordsToday, goal);
        const {
            streak: displayStreak,
            shielded: streakShielded,
            freezesRemaining,
        } = resolveDisplayStreak({
            streak: row.streak,
            lastPracticeDate: row.lastPracticeDate,
            freezes: row.streakFreezes,
            clientDate,
        });
        const displayGoalStreak = effectiveGoalStreak(
            row.goalStreak,
            row.lastGoalMetDate,
            clientDate,
        );
        const streakAtRisk = isStreakAtRisk(
            row.streak,
            row.lastPracticeDate,
            clientDate,
        );
        const wordsThisWeek = recentDays.reduce(
            (sum, day) => sum + day.words,
            0,
        );
        const daysActiveThisWeek = recentDays.filter(
            (day) => day.words > 0,
        ).length;
        const wordsRemaining = Math.max(0, goal - wordsToday);

        return {
            date: clientDate,
            wordsToday,
            streak: displayStreak,
            longestStreak: row.longestStreak,
            goalStreak: displayGoalStreak,
            longestGoalStreak: row.longestGoalStreak,
            lastPracticeDate: row.lastPracticeDate
                ? formatClientDate(row.lastPracticeDate)
                : null,
            goal,
            goalMetToday,
            totalWordsPracticed: row.totalWordsPracticed,
            totalPracticeDays: row.totalPracticeDays,
            totalGoalDays: row.totalGoalDays,
            wordsThisWeek,
            daysActiveThisWeek,
            recentDays,
            streakAtRisk,
            nextMilestone: nextStreakMilestone(displayStreak),
            streakFreezes: freezesRemaining,
            streakShielded,
            message: habitMotivation({
                goalMetToday,
                wordsToday,
                goal,
                streak: displayStreak,
                goalStreak: displayGoalStreak,
                wordsRemaining,
                streakAtRisk,
            }),
        };
    }

    private emptyResponse(
        clientDate: string,
        goal: number,
        recentDays: DailyHabitDayDto[],
    ): DailyHabitResponseDto {
        return {
            date: clientDate,
            wordsToday: 0,
            streak: 0,
            longestStreak: 0,
            goalStreak: 0,
            longestGoalStreak: 0,
            lastPracticeDate: null,
            goal,
            goalMetToday: false,
            totalWordsPracticed: 0,
            totalPracticeDays: 0,
            totalGoalDays: 0,
            wordsThisWeek: recentDays.reduce((sum, day) => sum + day.words, 0),
            daysActiveThisWeek: recentDays.filter((day) => day.words > 0)
                .length,
            recentDays,
            streakAtRisk: false,
            nextMilestone: nextStreakMilestone(0),
            streakFreezes: 0,
            streakShielded: false,
            message: habitMotivation({
                goalMetToday: false,
                wordsToday: 0,
                goal,
                streak: 0,
                goalStreak: 0,
                wordsRemaining: goal,
            }),
        };
    }
}
