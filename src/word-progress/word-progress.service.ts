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

/** Maximum interval in days — caps next review so words don't disappear for years. */
const MAX_INTERVAL_DAYS = 60;

@Injectable()
export class WordProgressService {
	constructor(private readonly prisma: PrismaService) { }

	private calculateNextReview(
		quality: AnswerQuality,
		easeFactor: number,
		interval: number,
		repetitions: number,
	): { easeFactor: number; interval: number; repetitions: number } {
		let newEaseFactor =
			easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));

		if (newEaseFactor < 1.3) {
			newEaseFactor = 1.3;
		}

		let newInterval: number;
		let newRepetitions: number;

		if (quality < AnswerQuality.CORRECT_WITH_DIFFICULTY) {
			newRepetitions = 0;
			newInterval = 1;
		} else {
			newRepetitions = repetitions + 1;

			if (newRepetitions === 1) {
				newInterval = 1;
			} else if (newRepetitions === 2) {
				newInterval = 6;
			} else {
				newInterval = Math.round(interval * newEaseFactor);
				if (newInterval > MAX_INTERVAL_DAYS) {
					newInterval = MAX_INTERVAL_DAYS;
				}
			}
		}

		return {
			easeFactor: newEaseFactor,
			interval: newInterval,
			repetitions: newRepetitions,
		};
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
	): Promise<WordProgress> {
		const isCorrect = quality >= AnswerQuality.CORRECT_WITH_DIFFICULTY;
		const where = {
			wordId_userLoginId: { wordId, userLoginId },
		} as const;
		const { easeFactor, interval, repetitions } = existing
			? this.calculateNextReview(
				quality,
				existing.easeFactor,
				existing.interval,
				existing.repetitions,
			)
			: this.calculateNextReview(quality, 2.5, 0, 0);

		const nextReviewAt = new Date(now);
		nextReviewAt.setDate(nextReviewAt.getDate() + interval);

		return tx.wordProgress.upsert({
			where,
			create: {
				id: uuidv7(),
				wordId,
				userLoginId,
				easeFactor,
				interval,
				repetitions,
				lastReviewedAt: now,
				nextReviewAt,
				totalReviews: 1,
				correctReviews: isCorrect ? 1 : 0,
			},
			update: {
				easeFactor,
				interval,
				repetitions,
				lastReviewedAt: now,
				nextReviewAt,
				totalReviews: { increment: 1 },
				...(isCorrect && {
					correctReviews: { increment: 1 },
				}),
			},
		});
	}

	async recordAnswer(
		recordAnswerDto: RecordAnswerDto,
	): Promise<WordProgressResponseDto> {
		const { wordId, quality, userLoginId } = recordAnswerDto;
		const now = new Date();

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
			return this.mapToProgressResponse(wordProgress);
		});
	}

	async recordAnswersBulk(
		userLoginId: string,
		answers: BulkAnswerItemDto[],
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
		const wordIds = deduped.map((answer) => answer.wordId);

		return await this.prisma.$transaction(async (tx) => {
			const existingList = await tx.wordProgress.findMany({
				where: { userLoginId, wordId: { in: wordIds } },
			});
			const existingByWordId = new Map(
				existingList.map((progress) => [progress.wordId, progress]),
			);

			const results: WordProgressResponseDto[] = [];
			for (const { wordId, quality } of deduped) {
				const wordProgress = await this.upsertAnswer(
					tx,
					userLoginId,
					wordId,
					quality,
					existingByWordId.get(wordId) ?? null,
					now,
				);
				existingByWordId.set(wordId, wordProgress);
				results.push(this.mapToProgressResponse(wordProgress));
			}
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
