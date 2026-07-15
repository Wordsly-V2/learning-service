import { PrismaService } from '@/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { DailyHabit, DailyHabitDay } from '@prisma/client';
import {
    ACTIVITY_HISTORY_DAYS,
    DAILY_GOAL_WORDS,
    DailyHabitDayDto,
    DailyHabitResponseDto,
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
    effectiveGoalStreak,
    freezesAfterPractice,
    habitMotivation,
    isGoalMet,
    isStreakAtRisk,
    isStreakMilestone,
    lastNDays,
    nextGoalStreak,
    nextPracticeStreakWithFreezes,
    nextStreakMilestone,
    resolveDisplayStreak,
} from './daily-habit.logic';
import { UserLevelService } from '@/user-level/user-level.service';
import {
    XP_DAILY_GOAL_MET,
    XP_FIRST_PRACTICE_OF_DAY,
    XP_STREAK_MILESTONE,
} from '@/user-level/user-level.logic';
import { AchievementService } from '@/achievement/achievement.service';

type DailyHabitRow = DailyHabit & { days?: DailyHabitDay[] };

@Injectable()
export class DailyHabitService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userLevelService: UserLevelService,
        private readonly achievementService: AchievementService,
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

    async recordPractice(
        userLoginId: string,
        body: RecordDailyPracticeDto,
    ): Promise<DailyHabitResponseDto> {
        const { wordCount, clientDate } = body;
        const today = parseClientDate(clientDate);
        const yesterday = parseClientDate(yesterdayClientDate(clientDate));

        const { row: updated, unlockedAchievements } =
            await this.prisma.$transaction(async (tx) => {
                const existing = await tx.dailyHabit.findUnique({
                    where: { userLoginId },
                });
                const dailyGoal = existing?.dailyGoal ?? DAILY_GOAL_WORDS;

                if (!existing) {
                    const goalMetToday = isGoalMet(wordCount, dailyGoal);
                    const row = await tx.dailyHabit.create({
                        data: {
                            userLoginId,
                            dailyGoal,
                            wordsToday: wordCount,
                            streak: 1,
                            longestStreak: 1,
                            goalStreak: goalMetToday ? 1 : 0,
                            longestGoalStreak: goalMetToday ? 1 : 0,
                            practiceDate: today,
                            lastPracticeDate: today,
                            lastGoalMetDate: goalMetToday ? today : null,
                            totalWordsPracticed: wordCount,
                            totalPracticeDays: 1,
                        },
                    });
                    await tx.dailyHabitDay.create({
                        data: {
                            userLoginId,
                            practiceDate: today,
                            wordsPracticed: wordCount,
                            goalMet: goalMetToday,
                        },
                    });
                    // First practice ever = first of the day; goal XP if the goal was met.
                    await this.userLevelService.awardXp(
                        tx,
                        userLoginId,
                        XP_FIRST_PRACTICE_OF_DAY +
                            (goalMetToday ? XP_DAILY_GOAL_MET : 0),
                    );
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
                }

                const sameDay = datesEqual(existing.practiceDate, today);
                const wordsToday = sameDay
                    ? existing.wordsToday + wordCount
                    : wordCount;
                const isNewCalendarDay = !sameDay;

                const streakResult = nextPracticeStreakWithFreezes({
                    currentStreak: existing.streak,
                    lastPracticeDate: existing.lastPracticeDate,
                    freezes: existing.streakFreezes,
                    clientDate,
                });
                const streak = streakResult.streak;
                const longestStreak = Math.max(existing.longestStreak, streak);

                const dayRecord = await tx.dailyHabitDay.upsert({
                    where: {
                        userLoginId_practiceDate: {
                            userLoginId,
                            practiceDate: today,
                        },
                    },
                    create: {
                        userLoginId,
                        practiceDate: today,
                        wordsPracticed: wordCount,
                        goalMet: isGoalMet(wordCount, dailyGoal),
                    },
                    update: {
                        wordsPracticed: { increment: wordCount },
                    },
                });

                const goalMetToday = isGoalMet(wordsToday, dailyGoal);
                if (dayRecord.goalMet !== goalMetToday) {
                    await tx.dailyHabitDay.update({
                        where: {
                            userLoginId_practiceDate: {
                                userLoginId,
                                practiceDate: today,
                            },
                        },
                        data: { goalMet: goalMetToday },
                    });
                }

                const goalUpdate = nextGoalStreak(
                    existing.goalStreak,
                    existing.lastGoalMetDate,
                    today,
                    yesterday,
                    goalMetToday,
                );
                const longestGoalStreak = Math.max(
                    existing.longestGoalStreak,
                    goalUpdate.goalStreak,
                );

                const streakFreezes = freezesAfterPractice({
                    currentFreezes: existing.streakFreezes,
                    freezesConsumed: streakResult.freezesConsumed,
                    prevGoalStreak: existing.goalStreak,
                    newGoalStreak: goalUpdate.goalStreak,
                    goalMetToday,
                });

                // Consistency XP, each granted once on its crossing:
                // first practice of a new day, the goal first met today, and the streak
                // landing on a milestone (streak only grows on a genuinely new day).
                const goalNewlyMetToday =
                    goalMetToday &&
                    !(
                        existing.lastGoalMetDate &&
                        datesEqual(existing.lastGoalMetDate, today)
                    );
                const streakMilestoneReached =
                    streak > existing.streak && isStreakMilestone(streak);
                const habitXp =
                    (isNewCalendarDay ? XP_FIRST_PRACTICE_OF_DAY : 0) +
                    (goalNewlyMetToday ? XP_DAILY_GOAL_MET : 0) +
                    (streakMilestoneReached ? XP_STREAK_MILESTONE : 0);
                await this.userLevelService.awardXp(tx, userLoginId, habitXp);

                const row = await tx.dailyHabit.update({
                    where: { userLoginId },
                    data: {
                        wordsToday,
                        streak,
                        longestStreak,
                        goalStreak: goalUpdate.goalStreak,
                        longestGoalStreak,
                        practiceDate: today,
                        lastPracticeDate: today,
                        lastGoalMetDate: goalUpdate.lastGoalMetDate,
                        streakFreezes,
                        ...(streakResult.freezesConsumed > 0 && {
                            lastFreezeUsedDate: today,
                        }),
                        totalWordsPracticed: { increment: wordCount },
                        ...(isNewCalendarDay && {
                            totalPracticeDays: { increment: 1 },
                        }),
                    },
                });
                // Detect unlocks against the final totals (runs after the update so a
                // freeze reward is capped against the just-written streakFreezes).
                const unlocked = await this.achievementService.detectAndUnlock(
                    tx,
                    userLoginId,
                    {
                        longestStreak: row.longestStreak,
                        totalWordsPracticed: row.totalWordsPracticed,
                        totalPracticeDays: row.totalPracticeDays,
                    },
                );
                return { row, unlockedAchievements: unlocked };
            });

        const recentDays = await this.loadRecentDays(userLoginId, clientDate);
        return {
            ...this.toResponse(updated, clientDate, recentDays),
            unlockedAchievements,
        };
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

            const updated = await this.prisma.dailyHabit.update({
                where: { userLoginId },
                data: {
                    dailyGoal: body.dailyGoal,
                    goalStreak: goalUpdate.goalStreak,
                    longestGoalStreak,
                    lastGoalMetDate: goalUpdate.lastGoalMetDate,
                    streakFreezes,
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
        const { streak: displayStreak, shielded: streakShielded } =
            resolveDisplayStreak({
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
            wordsThisWeek,
            daysActiveThisWeek,
            recentDays,
            streakAtRisk,
            nextMilestone: nextStreakMilestone(displayStreak),
            streakFreezes: row.streakFreezes,
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
