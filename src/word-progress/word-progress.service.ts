import { PrismaService } from '@/prisma/prisma.service';
import { BadRequestException, Injectable } from '@nestjs/common';
import { WordProgress } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import {
    AnswerQuality,
    BulkAnswerItemDto,
    BulkRecordAnswersResponseDto,
    DueWordIdsResponseDto,
    GetDueWordIdsDto,
    LeechesResponseDto,
    MAX_BULK_ANSWERS,
    RecordAnswerDto,
    ScopeWordIdsDto,
    WordProgressResponseDto,
    WordProgressStatsDto,
} from './dto/word-progress.dto';
import type { Prisma } from '@prisma/client';
import {
    calculateNextReview,
    toSchedulerInput,
} from './word-progress-scheduler';
import {
    formatClientDate,
    parseClientDate,
} from '@/daily-habit/daily-habit-date.util';
import { UserLevelService } from '@/user-level/user-level.service';
import {
    applyStreakMultiplier,
    isMastered,
    streakXpMultiplier,
    xpForAnswer,
} from '@/user-level/user-level.logic';
import { effectiveGoalStreak } from '@/daily-habit/daily-habit.logic';
import { LearningSettingsService } from '@/learning-settings/learning-settings.service';
import {
    computePacingBudget,
    newWordTake,
    reviewTake,
} from './word-progress-pacing.logic';

type ProgressStatsRow = Pick<
    WordProgress,
    | 'wordId'
    | 'repetitions'
    | 'nextReviewAt'
    | 'totalReviews'
    | 'correctReviews'
    | 'suspendedAt'
>;

@Injectable()
export class WordProgressService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userLevelService: UserLevelService,
        private readonly learningSettingsService: LearningSettingsService,
    ) {}

    /** Live goal streak for XP multiplier, decayed to the client's "today". */
    private async liveGoalStreak(
        tx: Prisma.TransactionClient,
        userLoginId: string,
        clientDate: string | undefined,
        now: Date,
    ): Promise<number> {
        const habit = await tx.dailyHabit.findUnique({
            where: { userLoginId },
            select: { goalStreak: true, lastGoalMetDate: true },
        });
        if (!habit) {
            return 0;
        }
        return effectiveGoalStreak(
            habit.goalStreak,
            habit.lastGoalMetDate,
            clientDate ?? formatClientDate(now),
        );
    }

    private dedupeBulkAnswers(
        answers: BulkAnswerItemDto[],
    ): BulkAnswerItemDto[] {
        const byWordId = new Map<string, BulkAnswerItemDto>();
        for (const answer of answers) {
            byWordId.set(answer.wordId, answer);
        }
        return [...byWordId.values()];
    }

    private async upsertAnswer(
        tx: Prisma.TransactionClient,
        userLoginId: string,
        wordId: string,
        quality: AnswerQuality,
        existing: WordProgress | null,
        now: Date,
        leechConfig: { threshold: number; autoSuspend: boolean },
    ): Promise<WordProgress> {
        const isCorrect = quality >= AnswerQuality.CORRECT_WITH_DIFFICULTY;
        const where = {
            wordId_userLoginId: { wordId, userLoginId },
        } as const;
        const {
            easeFactor,
            interval,
            repetitions,
            stability,
            nextReviewAt,
            state,
            lapses,
            learningSteps,
        } = calculateNextReview(quality, toSchedulerInput(existing, now), now);

        const isLeech = lapses >= leechConfig.threshold;
        // A correct answer keeps the card in rotation (clears any suspension);
        // an incorrect answer on a leech auto-suspends it when enabled. Otherwise
        // the previous suspension state is preserved.
        let suspendedAt: Date | null = existing?.suspendedAt ?? null;
        if (isCorrect) {
            suspendedAt = null;
        } else if (leechConfig.autoSuspend && isLeech) {
            suspendedAt = suspendedAt ?? now;
        }

        return tx.wordProgress.upsert({
            where,
            create: {
                id: uuidv7(),
                wordId,
                userLoginId,
                easeFactor,
                interval,
                repetitions,
                stability,
                state,
                lapses,
                learningSteps,
                lastReviewedAt: now,
                nextReviewAt,
                totalReviews: 1,
                correctReviews: isCorrect ? 1 : 0,
                isLeech,
                suspendedAt,
            },
            update: {
                easeFactor,
                interval,
                repetitions,
                stability,
                state,
                lapses,
                learningSteps,
                lastReviewedAt: now,
                nextReviewAt,
                totalReviews: { increment: 1 },
                ...(isCorrect && {
                    correctReviews: { increment: 1 },
                }),
                isLeech,
                suspendedAt,
            },
        });
    }

    /**
     * Upsert the per-day review aggregate that powers the accuracy/improvement
     * chart. One atomic upsert per session (not per word) using DB-side
     * increments so concurrent sessions never lose writes.
     */
    private async recordReviewStat(
        tx: Prisma.TransactionClient,
        userLoginId: string,
        reviewDate: Date,
        delta: { reviews: number; correctReviews: number; newWords: number },
    ): Promise<void> {
        if (delta.reviews <= 0) {
            return;
        }
        await tx.dailyReviewStat.upsert({
            where: {
                userLoginId_reviewDate: { userLoginId, reviewDate },
            },
            create: {
                userLoginId,
                reviewDate,
                reviews: delta.reviews,
                correctReviews: delta.correctReviews,
                newWords: delta.newWords,
            },
            update: {
                reviews: { increment: delta.reviews },
                correctReviews: { increment: delta.correctReviews },
                newWords: { increment: delta.newWords },
            },
        });
    }

    /** Resolve the calendar date a review belongs to (client-local, else server). */
    private resolveReviewDate(clientDate: string | undefined, now: Date): Date {
        return parseClientDate(clientDate ?? formatClientDate(now));
    }

    async recordAnswer(
        recordAnswerDto: RecordAnswerDto,
    ): Promise<WordProgressResponseDto> {
        const { wordId, quality, userLoginId, clientDate } = recordAnswerDto;
        const now = new Date();
        const reviewDate = this.resolveReviewDate(clientDate, now);
        const settings =
            await this.learningSettingsService.getSettings(userLoginId);

        return await this.prisma.$transaction(async (tx) => {
            const existing = await tx.wordProgress.findUnique({
                where: { wordId_userLoginId: { wordId, userLoginId } },
            });
            const wordProgress = await this.upsertAnswer(
                tx,
                userLoginId,
                wordId,
                quality,
                existing,
                now,
                {
                    threshold: settings.leechThreshold,
                    autoSuspend: settings.leechAutoSuspend,
                },
            );
            await this.recordReviewStat(tx, userLoginId, reviewDate, {
                reviews: 1,
                correctReviews:
                    quality >= AnswerQuality.CORRECT_WITH_DIFFICULTY ? 1 : 0,
                newWords: existing === null ? 1 : 0,
            });
            const baseXp = xpForAnswer({
                quality,
                isNewWord: existing === null,
                wasMastered: existing
                    ? isMastered(existing.state, existing.interval)
                    : false,
                isMastered: isMastered(
                    wordProgress.state,
                    wordProgress.interval,
                ),
            });
            const goalStreak = await this.liveGoalStreak(
                tx,
                userLoginId,
                clientDate,
                now,
            );
            const xp = applyStreakMultiplier(baseXp, goalStreak);
            const levelEvent = await this.userLevelService.awardXp(
                tx,
                userLoginId,
                xp,
            );
            return { ...this.mapToProgressResponse(wordProgress), levelEvent };
        });
    }

    async recordAnswersBulk(
        userLoginId: string,
        answers: BulkAnswerItemDto[],
        clientDate?: string,
    ): Promise<BulkRecordAnswersResponseDto> {
        if (answers.length === 0) {
            return { results: [], xpMultiplier: 1 };
        }
        if (answers.length > MAX_BULK_ANSWERS) {
            throw new BadRequestException(
                `Bulk save exceeds maximum of ${MAX_BULK_ANSWERS} answers`,
            );
        }

        const deduped = this.dedupeBulkAnswers(answers);
        const now = new Date();
        const reviewDate = this.resolveReviewDate(clientDate, now);
        const wordIds = deduped.map((answer) => answer.wordId);
        const settings =
            await this.learningSettingsService.getSettings(userLoginId);

        return await this.prisma.$transaction(async (tx) => {
            const existingList = await tx.wordProgress.findMany({
                where: { userLoginId, wordId: { in: wordIds } },
            });
            const existingByWordId = new Map(
                existingList.map((progress) => [progress.wordId, progress]),
            );

            const results: WordProgressResponseDto[] = [];
            let correctReviews = 0;
            let newWords = 0;
            let baseXpEarned = 0;
            for (const { wordId, quality } of deduped) {
                const prior = existingByWordId.get(wordId) ?? null;
                if (prior === null) {
                    newWords++;
                }
                if (quality >= AnswerQuality.CORRECT_WITH_DIFFICULTY) {
                    correctReviews++;
                }
                const wordProgress = await this.upsertAnswer(
                    tx,
                    userLoginId,
                    wordId,
                    quality,
                    prior,
                    now,
                    {
                        threshold: settings.leechThreshold,
                        autoSuspend: settings.leechAutoSuspend,
                    },
                );
                baseXpEarned += xpForAnswer({
                    quality,
                    isNewWord: prior === null,
                    wasMastered: prior
                        ? isMastered(prior.state, prior.interval)
                        : false,
                    isMastered: isMastered(
                        wordProgress.state,
                        wordProgress.interval,
                    ),
                });
                existingByWordId.set(wordId, wordProgress);
                results.push(this.mapToProgressResponse(wordProgress));
            }
            await this.recordReviewStat(tx, userLoginId, reviewDate, {
                reviews: deduped.length,
                correctReviews,
                newWords,
            });
            // One XP award for the whole session, scaled by the streak multiplier.
            const goalStreak = await this.liveGoalStreak(
                tx,
                userLoginId,
                clientDate,
                now,
            );
            const xpMultiplier = streakXpMultiplier(goalStreak);
            const xpEarned = applyStreakMultiplier(baseXpEarned, goalStreak);
            const levelEvent = await this.userLevelService.awardXp(
                tx,
                userLoginId,
                xpEarned,
            );
            return { results, levelEvent, xpMultiplier };
        });
    }

    async getDueWordIds(
        userLoginId: string,
        query: GetDueWordIdsDto,
    ): Promise<DueWordIdsResponseDto> {
        const { wordIds, limit = 20, includeNew = true, clientDate } = query;

        // Resolve today's pacing budget from settings + what's been done today.
        const now = new Date();
        const reviewDate = this.resolveReviewDate(clientDate, now);
        const [settings, todayStat] = await Promise.all([
            this.learningSettingsService.getSettings(userLoginId),
            this.prisma.dailyReviewStat.findUnique({
                where: {
                    userLoginId_reviewDate: { userLoginId, reviewDate },
                },
                select: { reviews: true, newWords: true },
            }),
        ]);
        const budget = computePacingBudget(
            {
                dailyNewWordLimit: settings.dailyNewWordLimit,
                dailyReviewLimit: settings.dailyReviewLimit,
            },
            {
                reviews: todayStat?.reviews ?? 0,
                newWords: todayStat?.newWords ?? 0,
            },
        );

        if (wordIds.length === 0) {
            return { wordIds: [], pacing: budget };
        }

        const dueLimit = reviewTake(limit, budget);

        // Most-overdue first: the words closest to being forgotten are the ones
        // whose review matters most, and the DB does the sort + limit for us.
        // Suspended cards are withheld from selection.
        const dueRows =
            dueLimit > 0
                ? await this.prisma.wordProgress.findMany({
                      where: {
                          userLoginId,
                          nextReviewAt: { lte: now },
                          suspendedAt: null,
                          wordId: { in: wordIds },
                      },
                      select: { wordId: true },
                      orderBy: { nextReviewAt: 'asc' },
                      take: dueLimit,
                  })
                : [];

        const dueIds = dueRows.map((r) => r.wordId);

        const newTake = includeNew
            ? newWordTake(limit, dueIds.length, budget)
            : 0;
        if (newTake <= 0) {
            return { wordIds: dueIds, pacing: budget };
        }

        const progressWordIds = await this.prisma.wordProgress.findMany({
            where: { userLoginId, wordId: { in: wordIds } },
            select: { wordId: true },
        });
        const progressSet = new Set(progressWordIds.map((p) => p.wordId));
        const newIds = wordIds
            .filter((id) => !progressSet.has(id))
            .slice(0, newTake);

        return { wordIds: [...dueIds, ...newIds], pacing: budget };
    }

    /** Leech cards within a scope, most-lapsed first. */
    async getLeeches(
        userLoginId: string,
        wordIds: string[],
    ): Promise<LeechesResponseDto> {
        if (wordIds.length === 0) {
            return { leeches: [] };
        }
        const rows = await this.prisma.wordProgress.findMany({
            where: { userLoginId, isLeech: true, wordId: { in: wordIds } },
            orderBy: { lapses: 'desc' },
        });
        return {
            leeches: rows.map((r) => ({
                wordId: r.wordId,
                lapses: r.lapses,
                state: r.state,
                totalReviews: r.totalReviews,
                correctReviews: r.correctReviews,
                successRate:
                    r.totalReviews > 0
                        ? Math.round(
                              (r.correctReviews / r.totalReviews) * 100 * 10,
                          ) / 10
                        : 0,
                suspendedAt: r.suspendedAt,
                nextReviewAt: r.nextReviewAt,
            })),
        };
    }

    /** Clear a card's suspension so it re-enters review selection. */
    async unsuspendWord(userLoginId: string, wordId: string): Promise<void> {
        await this.prisma.wordProgress.updateMany({
            where: { userLoginId, wordId },
            data: { suspendedAt: null },
        });
    }

    private computeStatsFromProgresses(
        totalWords: number,
        wordProgresses: ProgressStatsRow[],
        now: Date,
    ): WordProgressStatsDto {
        const newWords = totalWords - wordProgresses.length;
        let learningWords = 0;
        let reviewWords = 0;
        let dueToday = 0;
        let totalReviews = 0;
        let totalCorrect = 0;

        for (const progress of wordProgresses) {
            totalReviews += progress.totalReviews;
            totalCorrect += progress.correctReviews;
            if (progress.repetitions < 3) {
                learningWords++;
            } else {
                reviewWords++;
            }
            if (progress.nextReviewAt <= now && progress.suspendedAt == null) {
                dueToday++;
            }
        }

        const overallSuccessRate =
            totalReviews > 0
                ? Math.round((totalCorrect / totalReviews) * 100 * 10) / 10
                : 0;

        return {
            totalWords,
            newWords,
            learningWords,
            reviewWords,
            dueToday,
            overallSuccessRate,
        };
    }

    /** Stats only need a handful of columns — avoid hauling full rows into memory. */
    private async getProgressForWordIds(
        userLoginId: string,
        wordIds: string[],
    ): Promise<ProgressStatsRow[]> {
        if (wordIds.length === 0) {
            return [];
        }
        return this.prisma.wordProgress.findMany({
            where: { userLoginId, wordId: { in: wordIds } },
            select: {
                wordId: true,
                repetitions: true,
                nextReviewAt: true,
                totalReviews: true,
                correctReviews: true,
                suspendedAt: true,
            },
        });
    }

    async getProgressStats(
        userLoginId: string,
        wordIds: string[],
    ): Promise<WordProgressStatsDto> {
        const now = new Date();
        const wordProgresses = await this.getProgressForWordIds(
            userLoginId,
            wordIds,
        );

        return this.computeStatsFromProgresses(
            wordIds.length,
            wordProgresses,
            now,
        );
    }

    async getProgressStatsMapByScopes(
        userLoginId: string,
        scopes: ScopeWordIdsDto[],
    ): Promise<Map<string, WordProgressStatsDto>> {
        if (scopes.length === 0) return new Map();
        const now = new Date();

        const allWordIds = scopes.flatMap((scope) => scope.wordIds);
        const progressList = await this.getProgressForWordIds(
            userLoginId,
            allWordIds,
        );
        const progressByWordId = new Map(
            progressList.map((p) => [p.wordId, p]),
        );

        const result = new Map<string, WordProgressStatsDto>();
        for (const scope of scopes) {
            const progresses = scope.wordIds
                .map((wordId) => progressByWordId.get(wordId))
                .filter((p): p is ProgressStatsRow => p != null);
            result.set(
                scope.scopeId,
                this.computeStatsFromProgresses(
                    scope.wordIds.length,
                    progresses,
                    now,
                ),
            );
        }
        return result;
    }

    async getWordProgress(
        userLoginId: string,
        wordId: string,
    ): Promise<WordProgressResponseDto | null> {
        const progress = await this.prisma.wordProgress.findUnique({
            where: {
                wordId_userLoginId: { wordId, userLoginId },
            },
        });

        return progress ? this.mapToProgressResponse(progress) : null;
    }

    async getProgressMapByWordIds(
        userLoginId: string,
        wordIds: string[],
    ): Promise<Map<string, WordProgressResponseDto | null>> {
        if (wordIds.length === 0) {
            return new Map();
        }
        const progressList = await this.prisma.wordProgress.findMany({
            where: { userLoginId, wordId: { in: wordIds } },
        });
        const progressByWordId = new Map(
            progressList.map((p) => [p.wordId, p]),
        );
        const result = new Map<string, WordProgressResponseDto | null>();
        for (const wordId of wordIds) {
            const progress = progressByWordId.get(wordId);
            result.set(
                wordId,
                progress ? this.mapToProgressResponse(progress) : null,
            );
        }
        return result;
    }

    async resetProgress(userLoginId: string, wordId: string): Promise<void> {
        await this.prisma.wordProgress.deleteMany({
            where: { wordId, userLoginId },
        });
    }

    async deleteProgressForWords(wordIds: string[]): Promise<void> {
        await this.prisma.wordProgress.deleteMany({
            where: { wordId: { in: wordIds } },
        });
    }

    async resetProgressBulk(
        userLoginId: string,
        wordIds: string[],
    ): Promise<{ count: number }> {
        if (wordIds.length === 0) {
            return { count: 0 };
        }

        const result = await this.prisma.wordProgress.deleteMany({
            where: {
                userLoginId,
                wordId: { in: wordIds },
            },
        });
        return { count: result.count };
    }

    private mapToProgressResponse(
        progress: WordProgress,
    ): WordProgressResponseDto {
        const successRate =
            progress.totalReviews > 0
                ? Math.round(
                      (progress.correctReviews / progress.totalReviews) *
                          100 *
                          10,
                  ) / 10
                : 0;

        return {
            id: progress.id,
            wordId: progress.wordId,
            userLoginId: progress.userLoginId,
            easeFactor: progress.easeFactor,
            interval: progress.interval,
            repetitions: progress.repetitions,
            lastReviewedAt: progress.lastReviewedAt ?? undefined,
            nextReviewAt: progress.nextReviewAt,
            totalReviews: progress.totalReviews,
            correctReviews: progress.correctReviews,
            successRate,
            state: progress.state,
            lapses: progress.lapses,
            isLeech: progress.isLeech,
            suspendedAt: progress.suspendedAt,
        };
    }
}
