import { PrismaService } from '@/prisma/prisma.service';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { WordProgress } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import {
    AnswerQuality,
    BulkRecordAnswersDto,
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
import { nextCorrectStreak, resolveLeechState } from './leech.logic';
import {
    MAX_BATCH_DATES,
    prepareReplayBatch,
    resolveClientToday,
} from './word-progress-replay.logic';
import {
    SYNC_ENDPOINT_BULK_ANSWERS,
    SyncRequestService,
} from '@/sync/sync-request.service';

/**
 * Answers per calendar date that still earn XP. Deliberately an XP-only cap:
 * FSRS scheduling, totalReviews and DailyReviewStat are never capped, so a
 * genuine power user's learning is untouched and only the leaderboard currency
 * is bounded. ~3x the default dailyReviewLimit, so no honest user reaches it.
 */
export const XP_ELIGIBLE_ANSWERS_PER_DAY = 500;

interface ReviewStatDelta {
    reviews: number;
    correctReviews: number;
    newWords: number;
}

function getOrInitDelta(
    byDate: Map<string, ReviewStatDelta>,
    date: string,
): ReviewStatDelta {
    const existing = byDate.get(date);
    if (existing) {
        return existing;
    }
    const created: ReviewStatDelta = {
        reviews: 0,
        correctReviews: 0,
        newWords: 0,
    };
    byDate.set(date, created);
    return created;
}

/**
 * Whether this date still has XP-eligible answers left, prior rows included.
 * Called after the current answer has been counted into `deltaByDate`, so the
 * comparison is inclusive: answer number XP_ELIGIBLE_ANSWERS_PER_DAY still pays.
 */
function isXpEligible(
    date: string,
    priorReviewsByDate: Map<string, number>,
    deltaByDate: Map<string, ReviewStatDelta>,
): boolean {
    const prior = priorReviewsByDate.get(date) ?? 0;
    const inBatch = deltaByDate.get(date)?.reviews ?? 0;
    return prior + inBatch <= XP_ELIGIBLE_ANSWERS_PER_DAY;
}

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
    private readonly logger = new Logger(WordProgressService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly userLevelService: UserLevelService,
        private readonly learningSettingsService: LearningSettingsService,
        private readonly syncRequests: SyncRequestService,
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

    /**
     * Reviews already recorded per date, so the XP cap can be applied without
     * capping the reviews themselves. Read outside the transaction — it only
     * gates a currency, so a slightly stale count is harmless.
     */
    private async readPriorReviewCounts(
        userLoginId: string,
        dates: string[],
    ): Promise<Map<string, number>> {
        if (dates.length === 0) {
            return new Map();
        }
        const rows = await this.prisma.dailyReviewStat.findMany({
            where: {
                userLoginId,
                reviewDate: { in: dates.map(parseClientDate) },
            },
            select: { reviewDate: true, reviews: true },
        });
        return new Map(
            rows.map((row) => [formatClientDate(row.reviewDate), row.reviews]),
        );
    }

    private async upsertAnswer(
        tx: Prisma.TransactionClient,
        userLoginId: string,
        wordId: string,
        quality: AnswerQuality,
        existing: WordProgress | null,
        reviewedAt: Date,
        leechConfig: { threshold: number; autoSuspend: boolean },
    ): Promise<WordProgress> {
        const isCorrect = quality >= AnswerQuality.CORRECT_WITH_DIFFICULTY;
        const where = {
            wordId_userLoginId: { wordId, userLoginId },
        } as const;

        // Never let a replayed answer move a card backwards in time: an offline
        // batch can arrive after an online review of the same word.
        const effectiveAt =
            existing?.lastReviewedAt && existing.lastReviewedAt > reviewedAt
                ? existing.lastReviewedAt
                : reviewedAt;

        const {
            easeFactor,
            interval,
            repetitions,
            stability,
            nextReviewAt,
            state,
            lapses,
            learningSteps,
        } = calculateNextReview(
            quality,
            toSchedulerInput(existing, effectiveAt),
            effectiveAt,
        );

        const correctStreak = nextCorrectStreak(
            existing?.correctStreak ?? 0,
            isCorrect,
        );
        const leech = resolveLeechState({
            wasLeech: existing?.isLeech ?? false,
            lapsesAtRescue: existing?.lapsesAtRescue ?? 0,
            rescuedCount: existing?.rescuedCount ?? 0,
            lapses,
            state,
            correctStreak,
            threshold: leechConfig.threshold,
        });

        // A correct answer keeps the card in rotation (clears any suspension);
        // an incorrect answer on a leech auto-suspends it when enabled. Otherwise
        // the previous suspension state is preserved.
        let suspendedAt: Date | null = existing?.suspendedAt ?? null;
        if (isCorrect) {
            suspendedAt = null;
        } else if (leechConfig.autoSuspend && leech.isLeech) {
            suspendedAt = suspendedAt ?? effectiveAt;
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
                correctStreak,
                lastReviewedAt: effectiveAt,
                nextReviewAt,
                totalReviews: 1,
                correctReviews: isCorrect ? 1 : 0,
                isLeech: leech.isLeech,
                lapsesAtRescue: leech.lapsesAtRescue,
                rescuedCount: leech.rescuedCount,
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
                correctStreak,
                lastReviewedAt: effectiveAt,
                nextReviewAt,
                totalReviews: { increment: 1 },
                ...(isCorrect && {
                    correctReviews: { increment: 1 },
                }),
                isLeech: leech.isLeech,
                lapsesAtRescue: leech.lapsesAtRescue,
                rescuedCount: leech.rescuedCount,
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
        recordAnswerDto: RecordAnswerDto & { userLoginId: string },
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

    /**
     * Record a whole session's answers in one transaction.
     *
     * Answers may have been collected offline over several days, so each one
     * carries its own `reviewedAt` and its own calendar date. They are replayed
     * in chronological order with each card's state chained, which is what makes
     * repeated reviews of the same word inside one offline session advance FSRS
     * learning steps instead of collapsing to the last grade.
     */
    async recordAnswersBulk(
        userLoginId: string,
        body: BulkRecordAnswersDto,
    ): Promise<BulkRecordAnswersResponseDto> {
        if (body.answers.length === 0) {
            return { results: [], xpMultiplier: 1 };
        }
        if (body.answers.length > MAX_BULK_ANSWERS) {
            throw new BadRequestException(
                `Bulk save exceeds maximum of ${MAX_BULK_ANSWERS} answers`,
            );
        }

        const now = new Date();
        const clientToday = resolveClientToday(body.clientDate, now);
        const { answers, report } = prepareReplayBatch({
            answers: body.answers,
            tzOffsetMinutes: body.tzOffsetMinutes,
            clientDate: clientToday,
            now,
        });

        if (report.dates.length > MAX_BATCH_DATES) {
            throw new BadRequestException(
                `Bulk save spans ${report.dates.length} calendar dates, more than the maximum of ${MAX_BATCH_DATES}`,
            );
        }
        if (report.clampedFuture > 0 || report.clampedPast > 0) {
            this.logger.warn('offline-sync clamp', {
                userLoginId,
                answers: answers.length,
                clampedFuture: report.clampedFuture,
                clampedPast: report.clampedPast,
                inferred: report.inferred,
                dates: report.dates.length,
                spanDays: report.spanDays,
            });
        }

        const wordIds = [...new Set(answers.map((answer) => answer.wordId))];
        const settings =
            await this.learningSettingsService.getSettings(userLoginId);
        const priorReviewsByDate = await this.readPriorReviewCounts(
            userLoginId,
            report.dates,
        );

        return await this.syncRequests.runOnce<BulkRecordAnswersResponseDto>(
            userLoginId,
            body.clientRequestId,
            SYNC_ENDPOINT_BULK_ANSWERS,
            async (tx) => {
                const existingList = await tx.wordProgress.findMany({
                    where: { userLoginId, wordId: { in: wordIds } },
                });
                const stateByWordId = new Map(
                    existingList.map((progress) => [progress.wordId, progress]),
                );

                // Final state per word, in first-appearance order. The response
                // stays one row per word — returning three rows for one word
                // would break the client's wordId-keyed reconciliation.
                const finalByWordId = new Map<string, WordProgress>();
                const responseOrder: string[] = [];
                const deltaByDate = new Map<string, ReviewStatDelta>();
                let baseXpEarned = 0;

                for (const answer of answers) {
                    const prior = stateByWordId.get(answer.wordId) ?? null;
                    const wordProgress = await this.upsertAnswer(
                        tx,
                        userLoginId,
                        answer.wordId,
                        answer.quality,
                        prior,
                        answer.reviewedAt,
                        {
                            threshold: settings.leechThreshold,
                            autoSuspend: settings.leechAutoSuspend,
                        },
                    );

                    // Chain the state so the NEXT review of this word in the
                    // same batch sees the card this review produced.
                    stateByWordId.set(answer.wordId, wordProgress);
                    if (!finalByWordId.has(answer.wordId)) {
                        responseOrder.push(answer.wordId);
                    }
                    finalByWordId.set(answer.wordId, wordProgress);

                    const delta = getOrInitDelta(
                        deltaByDate,
                        answer.reviewDate,
                    );
                    delta.reviews++;
                    if (
                        answer.quality >= AnswerQuality.CORRECT_WITH_DIFFICULTY
                    ) {
                        delta.correctReviews++;
                    }
                    // First-ever answer only, so a word first seen on day 1 of a
                    // multi-day batch counts as new on day 1 and nowhere else.
                    if (prior === null) {
                        delta.newWords++;
                    }

                    if (
                        isXpEligible(
                            answer.reviewDate,
                            priorReviewsByDate,
                            deltaByDate,
                        )
                    ) {
                        baseXpEarned += xpForAnswer({
                            quality: answer.quality,
                            isNewWord: prior === null,
                            wasMastered: prior
                                ? isMastered(prior.state, prior.interval)
                                : false,
                            isMastered: isMastered(
                                wordProgress.state,
                                wordProgress.interval,
                            ),
                        });
                    }
                }

                // One aggregate row per calendar date, so a multi-day flush
                // produces correct per-day chart rows instead of dumping
                // everything on the day it happened to sync.
                for (const [date, delta] of deltaByDate) {
                    await this.recordReviewStat(
                        tx,
                        userLoginId,
                        parseClientDate(date),
                        delta,
                    );
                }

                // One XP award for the whole session, scaled by the streak
                // multiplier live at the client's today — XP is earned when it is
                // banked, so the multiplier is deliberately not back-datable.
                const goalStreak = await this.liveGoalStreak(
                    tx,
                    userLoginId,
                    clientToday,
                    now,
                );
                const xpMultiplier = streakXpMultiplier(goalStreak);
                const xpEarned = applyStreakMultiplier(
                    baseXpEarned,
                    goalStreak,
                );
                const levelEvent = await this.userLevelService.awardXp(
                    tx,
                    userLoginId,
                    xpEarned,
                );

                return {
                    results: responseOrder.map((wordId) =>
                        this.mapToProgressResponse(finalByWordId.get(wordId)!),
                    ),
                    levelEvent,
                    xpMultiplier,
                };
            },
            {
                // Prisma's default interactive timeout is 5s, which a
                // MAX_BULK_ANSWERS-sized batch of sequential upserts will blow.
                maxWait: 10_000,
                timeout: 60_000,
                emptyOnTruncated: () => ({ results: [], xpMultiplier: 1 }),
            },
        );
    }

    async getDueWordIds(
        userLoginId: string,
        query: GetDueWordIdsDto,
    ): Promise<DueWordIdsResponseDto> {
        const {
            // The controller resolves the scope before calling, so a list is
            // always present in practice; the default keeps the type honest.
            wordIds = [],
            limit = 20,
            newLimit,
            includeNew = true,
            clientDate,
        } = query;

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
            ? newWordTake(limit, dueIds.length, budget, newLimit)
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
