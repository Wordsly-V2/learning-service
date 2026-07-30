import { PrismaService } from '@/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import {
    formatClientDate,
    parseClientDate,
} from '@/daily-habit/daily-habit-date.util';
import {
    effectiveGoalStreak,
    resolveDisplayStreak,
} from '@/daily-habit/daily-habit.logic';
import {
    accuracyPercent,
    bucketKeyForDate,
    buildReportRange,
    buildReviewForecast,
    computeAchievements,
    MASTERED_INTERVAL_DAYS,
    ReportPeriod,
    reviewedWordCount,
} from './learning-report.logic';
import { addClientDays } from '@/daily-habit/daily-habit.logic';
import { computeLevelProgress } from '@/user-level/user-level.logic';
import {
    ActivityCalendarResponseDto,
    LearningReportResponseDto,
    ReportBucketDto,
    ReviewForecastResponseDto,
} from './dto/learning-report.dto';

/** FSRS State enum value for cards in the Review phase. */
const FSRS_STATE_REVIEW = 2;

@Injectable()
export class LearningReportService {
    constructor(private readonly prisma: PrismaService) {}

    async getReport(
        userLoginId: string,
        period: ReportPeriod,
        clientDate: string,
    ): Promise<LearningReportResponseDto> {
        const range = buildReportRange(period, clientDate);
        const start = parseClientDate(range.start);
        const end = parseClientDate(range.end);

        // Independent reads run together. Time-series scans are bounded by the
        // window (≤365 rows); mastery uses aggregate queries so the per-word
        // table is never loaded into memory.
        const [
            habitDays,
            reviewStats,
            stateGroups,
            masteredWords,
            leechCount,
            habit,
            userLevel,
            unlockedRows,
        ] = await Promise.all([
            this.prisma.dailyHabitDay.findMany({
                where: {
                    userLoginId,
                    practiceDate: { gte: start, lte: end },
                },
                select: {
                    practiceDate: true,
                    wordsPracticed: true,
                    goalMet: true,
                },
            }),
            this.prisma.dailyReviewStat.findMany({
                where: {
                    userLoginId,
                    reviewDate: { gte: start, lte: end },
                },
                select: {
                    reviewDate: true,
                    reviews: true,
                    correctReviews: true,
                    newWords: true,
                },
            }),
            this.prisma.wordProgress.groupBy({
                by: ['state'],
                where: { userLoginId },
                _count: { _all: true },
            }),
            this.prisma.wordProgress.count({
                where: {
                    userLoginId,
                    state: FSRS_STATE_REVIEW,
                    interval: { gte: MASTERED_INTERVAL_DAYS },
                },
            }),
            this.prisma.wordProgress.count({
                where: { userLoginId, isLeech: true },
            }),
            this.prisma.dailyHabit.findUnique({ where: { userLoginId } }),
            this.prisma.userLevel.findUnique({ where: { userLoginId } }),
            this.prisma.userAchievement.findMany({
                where: { userLoginId },
                select: { key: true, unlockedAt: true },
            }),
        ]);

        // Seed every bucket so empty days/months render as zeros (no gaps).
        const buckets = new Map<string, ReportBucketDto>();
        for (const def of range.buckets) {
            buckets.set(def.key, {
                key: def.key,
                start: def.start,
                wordsPracticed: 0,
                reviewedWords: 0,
                reviews: 0,
                correctReviews: 0,
                accuracy: null,
                daysActive: 0,
                goalMetDays: 0,
                newWords: 0,
            });
        }

        let wordsLearned = 0;
        let activeDays = 0;
        let goalMetDays = 0;
        for (const day of habitDays) {
            const bucket = buckets.get(
                bucketKeyForDate(
                    formatClientDate(day.practiceDate),
                    range.granularity,
                ),
            );
            if (!bucket) continue;
            bucket.wordsPracticed += day.wordsPracticed;
            wordsLearned += day.wordsPracticed;
            if (day.wordsPracticed > 0) {
                bucket.daysActive += 1;
                activeDays += 1;
            }
            if (day.goalMet) {
                bucket.goalMetDays += 1;
                goalMetDays += 1;
            }
        }

        let totalReviews = 0;
        let totalCorrect = 0;
        let newWords = 0;
        for (const stat of reviewStats) {
            const bucket = buckets.get(
                bucketKeyForDate(
                    formatClientDate(stat.reviewDate),
                    range.granularity,
                ),
            );
            if (!bucket) continue;
            bucket.reviews += stat.reviews;
            bucket.correctReviews += stat.correctReviews;
            bucket.newWords += stat.newWords;
            totalReviews += stat.reviews;
            totalCorrect += stat.correctReviews;
            newWords += stat.newWords;
        }

        const bucketList = range.buckets.map((def) => {
            const bucket = buckets.get(def.key)!;
            bucket.accuracy = accuracyPercent(
                bucket.correctReviews,
                bucket.reviews,
            );
            bucket.reviewedWords = reviewedWordCount(
                bucket.wordsPracticed,
                bucket.newWords,
            );
            return bucket;
        });

        const totalStarted = stateGroups.reduce(
            (sum, group) => sum + group._count._all,
            0,
        );
        const reviewStateTotal =
            stateGroups.find((group) => group.state === FSRS_STATE_REVIEW)
                ?._count._all ?? 0;
        const reviewWords = Math.max(0, reviewStateTotal - masteredWords);
        const learningWords = Math.max(0, totalStarted - reviewStateTotal);

        const streaks = habit
            ? {
                  current: resolveDisplayStreak({
                      streak: habit.streak,
                      lastPracticeDate: habit.lastPracticeDate,
                      freezes: habit.streakFreezes,
                      clientDate,
                  }).streak,
                  longest: habit.longestStreak,
                  goalStreak: effectiveGoalStreak(
                      habit.goalStreak,
                      habit.lastGoalMetDate,
                      clientDate,
                  ),
                  longestGoalStreak: habit.longestGoalStreak,
              }
            : { current: 0, longest: 0, goalStreak: 0, longestGoalStreak: 0 };

        const unlockedAtByKey = new Map(
            unlockedRows.map((row) => [row.key, row.unlockedAt]),
        );
        const achievements = computeAchievements({
            longestStreak: habit?.longestStreak ?? 0,
            totalWordsPracticed: habit?.totalWordsPracticed ?? 0,
            totalPracticeDays: habit?.totalPracticeDays ?? 0,
        }).map((a) => ({
            ...a,
            unlockedAt: unlockedAtByKey.get(a.key) ?? null,
        }));

        return {
            period: range.period,
            granularity: range.granularity,
            range: { start: range.start, end: range.end },
            buckets: bucketList,
            summary: {
                wordsLearned,
                // Summed per bucket so the cards match the stacked chart.
                reviewedWords: bucketList.reduce(
                    (sum, bucket) => sum + bucket.reviewedWords,
                    0,
                ),
                totalReviews,
                avgAccuracy: accuracyPercent(totalCorrect, totalReviews) ?? 0,
                activeDays,
                goalMetDays,
                newWords,
            },
            mastery: {
                learningWords,
                reviewWords,
                masteredWords,
                totalStarted,
                leeches: leechCount,
            },
            streaks,
            level: computeLevelProgress(userLevel?.totalXp ?? 0),
            achievements,
        };
    }

    /** Per-day count of upcoming reviews for the next `days` days. */
    async getReviewForecast(
        userLoginId: string,
        days: number,
        clientDate: string,
    ): Promise<ReviewForecastResponseDto> {
        const end = parseClientDate(addClientDays(clientDate, days));
        const rows = await this.prisma.wordProgress.findMany({
            where: {
                userLoginId,
                suspendedAt: null,
                state: { not: 0 },
                nextReviewAt: { lt: end },
            },
            select: { nextReviewAt: true },
        });
        return buildReviewForecast(
            clientDate,
            days,
            rows.map((r) => r.nextReviewAt),
        );
    }

    /** Trailing 365 days of practice activity for a calendar heatmap. */
    async getActivityCalendar(
        userLoginId: string,
        clientDate: string,
    ): Promise<ActivityCalendarResponseDto> {
        const startStr = addClientDays(clientDate, -364);
        const start = parseClientDate(startStr);
        const end = parseClientDate(clientDate);
        const rows = await this.prisma.dailyHabitDay.findMany({
            where: {
                userLoginId,
                practiceDate: { gte: start, lte: end },
            },
            select: {
                practiceDate: true,
                wordsPracticed: true,
                goalMet: true,
            },
            orderBy: { practiceDate: 'asc' },
        });
        return {
            start: startStr,
            end: clientDate,
            days: rows.map((r) => ({
                date: formatClientDate(r.practiceDate),
                wordsPracticed: r.wordsPracticed,
                goalMet: r.goalMet,
            })),
        };
    }
}
