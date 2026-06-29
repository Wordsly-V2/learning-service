import { PrismaService } from '@/prisma/prisma.service';
import { BadRequestException, Injectable } from '@nestjs/common';
import { WordProgress } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import {
    AnswerQuality,
    BulkAnswerItemDto,
    GetDueWordIdsDto,
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
import { isMastered, xpForAnswer } from '@/user-level/user-level.logic';

@Injectable()
export class WordProgressService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userLevelService: UserLevelService,
    ) {}

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
            );
            await this.recordReviewStat(tx, userLoginId, reviewDate, {
                reviews: 1,
                correctReviews:
                    quality >= AnswerQuality.CORRECT_WITH_DIFFICULTY ? 1 : 0,
                newWords: existing === null ? 1 : 0,
            });
            const xp = xpForAnswer({
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
    ): Promise<WordProgressResponseDto[]> {
        if (answers.length === 0) {
            return [];
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
            let xpEarned = 0;
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
                );
                xpEarned += xpForAnswer({
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
            // One XP award for the whole session; the level snapshot is read via
            // GET /level after the session, so the array response stays unchanged.
            await this.userLevelService.awardXp(tx, userLoginId, xpEarned);
            return results;
        });
    }

    async getDueWordIds(
        userLoginId: string,
        query: GetDueWordIdsDto,
    ): Promise<string[]> {
        const { wordIds, limit = 20, includeNew = true } = query;
        if (wordIds.length === 0) {
            return [];
        }

        const now = new Date();

        const dueRows = await this.prisma.wordProgress.findMany({
            where: {
                userLoginId,
                nextReviewAt: { lte: now },
                wordId: { in: wordIds },
            },
            select: { wordId: true, nextReviewAt: true },
        });

        const dueIds = dueRows
            .sort((a, b) => b.nextReviewAt.getTime() - a.nextReviewAt.getTime())
            .map((r) => r.wordId)
            .slice(0, limit);

        if (!includeNew || dueIds.length >= limit) {
            return dueIds;
        }

        const progressWordIds = await this.prisma.wordProgress.findMany({
            where: { userLoginId, wordId: { in: wordIds } },
            select: { wordId: true },
        });
        const progressSet = new Set(progressWordIds.map((p) => p.wordId));
        const newTake = limit - dueIds.length;
        const newIds = wordIds
            .filter((id) => !progressSet.has(id))
            .slice(0, newTake);

        return [...dueIds, ...newIds];
    }

    private computeStatsFromProgresses(
        totalWords: number,
        wordProgresses: WordProgress[],
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
            if (progress.nextReviewAt <= now) {
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

    private async getProgressForWordIds(
        userLoginId: string,
        wordIds: string[],
    ): Promise<WordProgress[]> {
        if (wordIds.length === 0) {
            return [];
        }
        return this.prisma.wordProgress.findMany({
            where: { userLoginId, wordId: { in: wordIds } },
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
                .filter((p): p is WordProgress => p != null);
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
        const result = new Map<string, WordProgressResponseDto | null>();
        for (const wordId of wordIds) {
            const progress = progressList.find((p) => p.wordId === wordId);
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
        };
    }
}
