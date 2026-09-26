import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { addClientDays } from '@/daily-habit/daily-habit.logic';
import { formatClientDate } from '@/daily-habit/daily-habit-date.util';
import { type ItemSourceParam, toItemSource } from '@/word-scope/item-source';
import {
    bucketStreaks,
    type DateRange,
    fillDailyActivity,
    isStreakAlive,
    resolveRange,
    type ResetScope,
    shapeRetention,
    weekStart,
} from './admin-learning.logic';
import type {
    CardCounts,
    HardItem,
    LearnerOverview,
    LearnerSummary,
    LearningStats,
    ResetResult,
} from './dto/admin-learning.dto';

/** FSRS State: 0 = New, which is not yet scheduled and so never "due". */
const FSRS_STATE_NEW = 0;

/**
 * A learner is active on a day when they answered at least once or practised
 * at least one word. Frozen days (`words_practiced = 0`) do not count.
 */
const activitySql = (range?: DateRange) => Prisma.sql`
    SELECT user_login_id, review_date AS day FROM daily_review_stat
    WHERE reviews > 0 ${range ? Prisma.sql`AND review_date BETWEEN ${range.from}::date AND ${range.to}::date` : Prisma.empty}
    UNION
    SELECT user_login_id, practice_date AS day FROM daily_habit_day
    WHERE words_practiced > 0 ${range ? Prisma.sql`AND practice_date BETWEEN ${range.from}::date AND ${range.to}::date` : Prisma.empty}`;

/**
 * Cross-user reads and support actions behind `/admin/learning`. Every read is
 * an aggregate over the per-day tables (there is no per-review history), so a
 * query costs rows-per-day, never rows-per-answer.
 */
@Injectable()
export class AdminLearningService {
    private readonly logger = new Logger(AdminLearningService.name);

    constructor(private readonly prisma: PrismaService) {}

    async stats(from?: string, to?: string): Promise<LearningStats> {
        const range = resolveRange(from, to);
        if (typeof range === 'string') throw new BadRequestException(range);
        const today = range.to;

        const [
            activePerDay,
            reviewsPerDay,
            windows,
            habits,
            levels,
            retentionRows,
            cards,
        ] = await Promise.all([
            this.prisma.$queryRaw<{ date: string; learners: number }[]>`
                SELECT to_char(day, 'YYYY-MM-DD') AS date,
                       count(DISTINCT user_login_id)::int AS learners
                FROM (${activitySql(range)}) activity
                GROUP BY day`,
            this.prisma.$queryRaw<
                {
                    date: string;
                    reviews: number;
                    correctReviews: number;
                    newWords: number;
                }[]
            >`
                SELECT to_char(review_date, 'YYYY-MM-DD') AS date,
                       sum(reviews)::int AS "reviews",
                       sum(correct_reviews)::int AS "correctReviews",
                       sum(new_words)::int AS "newWords"
                FROM daily_review_stat
                WHERE review_date BETWEEN ${range.from}::date AND ${range.to}::date
                GROUP BY review_date`,
            this.prisma.$queryRaw<
                {
                    today: number;
                    week: number;
                    month: number;
                    inRange: number;
                }[]
            >`
                SELECT count(DISTINCT user_login_id) FILTER (WHERE day = ${today}::date)::int AS "today",
                       count(DISTINCT user_login_id) FILTER (WHERE day > ${addClientDays(today, -7)}::date)::int AS "week",
                       count(DISTINCT user_login_id) FILTER (WHERE day > ${addClientDays(today, -30)}::date)::int AS "month",
                       count(DISTINCT user_login_id) FILTER (WHERE day >= ${range.from}::date)::int AS "inRange"
                FROM (${activitySql({
                    from:
                        range.from < addClientDays(today, -29)
                            ? range.from
                            : addClientDays(today, -29),
                    to: today,
                })}) activity`,
            this.prisma.dailyHabit.findMany({
                select: { streak: true, lastPracticeDate: true },
            }),
            this.prisma.userLevel.groupBy({
                by: ['level'],
                _count: { _all: true },
                orderBy: { level: 'asc' },
            }),
            this.prisma.$queryRaw<
                { cohort: string; week: number; learners: number }[]
            >`
                WITH activity AS (${activitySql()}),
                first_day AS (
                    SELECT user_login_id, min(day) AS first_day
                    FROM activity GROUP BY user_login_id
                ),
                cohort AS (
                    SELECT user_login_id,
                           date_trunc('week', first_day)::date AS cohort_week
                    FROM first_day
                    WHERE first_day BETWEEN ${range.from}::date AND ${range.to}::date
                )
                SELECT to_char(c.cohort_week, 'YYYY-MM-DD') AS cohort,
                       ((date_trunc('week', a.day)::date - c.cohort_week) / 7)::int AS week,
                       count(DISTINCT a.user_login_id)::int AS learners
                FROM cohort c
                JOIN activity a ON a.user_login_id = c.user_login_id
                WHERE a.day >= c.cohort_week AND a.day <= ${range.to}::date
                GROUP BY 1, 2`,
            this.prisma.$queryRaw<
                { source: string; cards: number; due: number }[]
            >`
                SELECT source,
                       count(*)::int AS cards,
                       count(*) FILTER (
                           WHERE fsrs_state <> ${FSRS_STATE_NEW}
                             AND suspended_at IS NULL
                             AND next_review_at <= now()
                       )::int AS due
                FROM word_progress
                GROUP BY source
                ORDER BY source`,
        ]);

        const daily = fillDailyActivity(range, activePerDay, reviewsPerDay);
        const window = windows[0];
        return {
            ...range,
            activeToday: window?.today ?? 0,
            weeklyActive: window?.week ?? 0,
            monthlyActive: window?.month ?? 0,
            activeInRange: window?.inRange ?? 0,
            totals: {
                reviews: sum(daily, 'reviews'),
                correctReviews: sum(daily, 'correctReviews'),
                newWords: sum(daily, 'newWords'),
            },
            daily,
            streaks: bucketStreaks(
                habits.map((habit) =>
                    isStreakAlive(dateOrNull(habit.lastPracticeDate), today)
                        ? habit.streak
                        : 0,
                ),
            ),
            levels: levels.map((row) => ({
                level: row.level,
                learners: row._count._all,
            })),
            retention: shapeRetention(retentionRows, weekStart(range.to)),
            cards,
        };
    }

    /** One row per requested id, zeros for learners with no data yet. */
    async summaries(ids: string[]): Promise<LearnerSummary[]> {
        const unique = [...new Set(ids)];
        const today = new Date().toISOString().slice(0, 10);

        const [lastActive, habits, levels, cards] = await Promise.all([
            this.prisma.$queryRaw<{ id: string; lastActive: string }[]>`
                SELECT user_login_id::text AS id,
                       to_char(max(day), 'YYYY-MM-DD') AS "lastActive"
                FROM (${activitySql()}) activity
                WHERE user_login_id = ANY(${unique}::uuid[])
                GROUP BY user_login_id`,
            this.prisma.dailyHabit.findMany({
                where: { userLoginId: { in: unique } },
                select: {
                    userLoginId: true,
                    streak: true,
                    lastPracticeDate: true,
                },
            }),
            this.prisma.userLevel.findMany({
                where: { userLoginId: { in: unique } },
                select: { userLoginId: true, level: true, totalXp: true },
            }),
            this.prisma.$queryRaw<{ id: string; cards: number; due: number }[]>`
                SELECT "userLoginId"::text AS id,
                       count(*)::int AS cards,
                       count(*) FILTER (
                           WHERE fsrs_state <> ${FSRS_STATE_NEW}
                             AND suspended_at IS NULL
                             AND next_review_at <= now()
                       )::int AS due
                FROM word_progress
                WHERE "userLoginId" = ANY(${unique}::uuid[])
                GROUP BY "userLoginId"`,
        ]);

        const activeBy = new Map(lastActive.map((r) => [r.id, r.lastActive]));
        const habitBy = new Map(habits.map((h) => [h.userLoginId, h]));
        const levelBy = new Map(levels.map((l) => [l.userLoginId, l]));
        const cardsBy = new Map(cards.map((c) => [c.id, c]));

        return unique.map((userLoginId) => {
            const habit = habitBy.get(userLoginId);
            const alive =
                habit &&
                isStreakAlive(dateOrNull(habit.lastPracticeDate), today);
            return {
                userLoginId,
                lastActiveDate: activeBy.get(userLoginId) ?? null,
                streak: alive ? habit.streak : 0,
                level: levelBy.get(userLoginId)?.level ?? 1,
                totalXp: levelBy.get(userLoginId)?.totalXp ?? 0,
                cards: cardsBy.get(userLoginId)?.cards ?? 0,
                dueNow: cardsBy.get(userLoginId)?.due ?? 0,
            };
        });
    }

    async overview(userLoginId: string): Promise<LearnerOverview> {
        const today = new Date().toISOString().slice(0, 10);
        const [[summary], habit, level, cards, achievements] =
            await Promise.all([
                this.summaries([userLoginId]),
                this.prisma.dailyHabit.findUnique({ where: { userLoginId } }),
                this.prisma.userLevel.findUnique({ where: { userLoginId } }),
                this.prisma.$queryRaw<CardCounts[]>`
                    SELECT source,
                           count(*)::int AS cards,
                           count(*) FILTER (
                               WHERE fsrs_state <> ${FSRS_STATE_NEW}
                                 AND suspended_at IS NULL
                                 AND next_review_at <= now()
                           )::int AS due,
                           count(*) FILTER (WHERE is_leech)::int AS leeches,
                           count(*) FILTER (WHERE suspended_at IS NOT NULL)::int AS suspended
                    FROM word_progress
                    WHERE "userLoginId" = ${userLoginId}::uuid
                    GROUP BY source
                    ORDER BY source`,
                this.prisma.userAchievement.count({ where: { userLoginId } }),
            ]);

        const lastPracticeDate = dateOrNull(habit?.lastPracticeDate ?? null);
        return {
            userLoginId,
            lastActiveDate: summary.lastActiveDate,
            habit: habit
                ? {
                      streak: habit.streak,
                      streakAlive: isStreakAlive(lastPracticeDate, today),
                      longestStreak: habit.longestStreak,
                      dailyGoal: habit.dailyGoal,
                      totalPracticeDays: habit.totalPracticeDays,
                      lastPracticeDate,
                      streakFreezes: habit.streakFreezes,
                  }
                : null,
            level: { level: level?.level ?? 1, totalXp: level?.totalXp ?? 0 },
            cards,
            achievements,
        };
    }

    /**
     * Clear part of one learner's progress in a single transaction. Each scope
     * leaves the rows the way a brand-new learner's would read: an empty habit
     * ledger recomputes to all zeros, so zeroing the counters here matches
     * what `recomputeHabitFromDays` would produce.
     */
    async reset(
        actorId: string,
        userLoginId: string,
        scope: ResetScope,
        source?: ItemSourceParam,
    ): Promise<ResetResult> {
        if (source && scope !== 'cards') {
            throw new BadRequestException(
                '`source` only applies to the `cards` scope',
            );
        }

        const affected = await this.prisma.$transaction(async (tx) => {
            const counts: Record<string, number> = {};
            const clearCards = scope === 'cards' || scope === 'all';
            const clearStreak = scope === 'streak' || scope === 'all';
            const clearXp = scope === 'xp' || scope === 'all';

            if (clearCards) {
                counts.wordProgress = (
                    await tx.wordProgress.deleteMany({
                        where: {
                            userLoginId,
                            ...(source ? { source: toItemSource(source) } : {}),
                        },
                    })
                ).count;
            }
            if (clearStreak) {
                counts.dailyHabitDay = (
                    await tx.dailyHabitDay.deleteMany({
                        where: { userLoginId },
                    })
                ).count;
                counts.dailyHabit = (
                    await tx.dailyHabit.updateMany({
                        where: { userLoginId },
                        data: {
                            wordsToday: 0,
                            streak: 0,
                            longestStreak: 0,
                            goalStreak: 0,
                            longestGoalStreak: 0,
                            lastPracticeDate: null,
                            lastGoalMetDate: null,
                            totalWordsPracticed: 0,
                            totalPracticeDays: 0,
                            totalGoalDays: 0,
                            streakFreezes: 0,
                            lastFreezeUsedDate: null,
                        },
                    })
                ).count;
            }
            if (clearXp) {
                counts.userLevel = (
                    await tx.userLevel.updateMany({
                        where: { userLoginId },
                        data: { totalXp: 0, level: 1 },
                    })
                ).count;
                counts.userAchievement = (
                    await tx.userAchievement.deleteMany({
                        where: { userLoginId },
                    })
                ).count;
                counts.dailyHabitGrant = (
                    await tx.dailyHabitGrant.deleteMany({
                        where: { userLoginId },
                    })
                ).count;
            }
            if (scope === 'all') {
                counts.dailyReviewStat = (
                    await tx.dailyReviewStat.deleteMany({
                        where: { userLoginId },
                    })
                ).count;
                counts.dailyPracticedWord = (
                    await tx.dailyPracticedWord.deleteMany({
                        where: { userLoginId },
                    })
                ).count;
            }
            return counts;
        });

        this.logger.log(
            `admin_action ${JSON.stringify({ actor: actorId, action: 'reset_progress', target: userLoginId, scope, source: source ?? null, affected })}`,
        );
        return { scope, source: source ?? null, affected };
    }

    /** Path items learners miss most: lowest accuracy first, then most lapses. */
    async hardestPathItems(limit = 20, minLearners = 3): Promise<HardItem[]> {
        const rows = await this.prisma.$queryRaw<
            {
                itemId: string;
                learners: number;
                reviews: number;
                correct: number;
                lapses: number;
            }[]
        >`
            SELECT "wordId"::text AS "itemId",
                   count(*)::int AS learners,
                   sum(total_reviews)::int AS reviews,
                   sum(correct_reviews)::int AS correct,
                   sum(lapses)::int AS lapses
            FROM word_progress
            WHERE source = ${toItemSource('path')} AND total_reviews > 0
            GROUP BY "wordId"
            HAVING count(*) >= ${minLearners}
            ORDER BY sum(correct_reviews)::float / sum(total_reviews) ASC,
                     sum(lapses) DESC
            LIMIT ${limit}`;
        return rows.map((row) => ({
            itemId: row.itemId,
            learners: row.learners,
            reviews: row.reviews,
            accuracy:
                row.reviews === 0
                    ? 0
                    : Math.round((row.correct / row.reviews) * 1000) / 1000,
            lapses: row.lapses,
        }));
    }
}

function sum<T extends Record<K, number>, K extends string>(
    rows: readonly T[],
    key: K,
): number {
    return rows.reduce((total, row) => total + row[key], 0);
}

function dateOrNull(date: Date | null): string | null {
    return date ? formatClientDate(date) : null;
}
