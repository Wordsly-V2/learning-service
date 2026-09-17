import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { SavedWordItemDto, SavedWordsResponseDto } from './dto/saved-word.dto';
import {
    FSRS_STATE_REVIEW,
    RESCUE_CORRECT_STREAK,
} from '@/word-progress/leech.logic';

@Injectable()
export class SavedWordService {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * Flag a word as hard. Idempotent: flagging an already-saved word updates
     * the note rather than failing, so the client can treat the button as a
     * plain toggle and a retried offline queue entry is harmless.
     */
    async save(
        userLoginId: string,
        wordId: string,
        note?: string,
    ): Promise<void> {
        await this.prisma.savedWord.upsert({
            where: { userLoginId_wordId: { userLoginId, wordId } },
            create: { userLoginId, wordId, note },
            // An undefined note leaves an existing one alone; the client clears
            // a note by sending an empty string.
            update: { note },
        });
    }

    /** Unflag a word. A no-op when it was not flagged. */
    async unsave(userLoginId: string, wordId: string): Promise<void> {
        await this.prisma.savedWord.deleteMany({
            where: { userLoginId, wordId },
        });
    }

    /**
     * The learner's saved words, newest first, each with enough progress to
     * render a row and decide what to practise.
     *
     * @param wordIds restrict to this scope; `undefined` means every saved word.
     */
    async list(
        userLoginId: string,
        wordIds?: string[],
    ): Promise<SavedWordsResponseDto> {
        if (wordIds?.length === 0) {
            return { savedWords: [] };
        }

        const saved = await this.prisma.savedWord.findMany({
            where: {
                userLoginId,
                ...(wordIds && { wordId: { in: wordIds } }),
            },
            orderBy: { createdAt: 'desc' },
        });
        if (saved.length === 0) {
            return { savedWords: [] };
        }

        // A saved word need not have been practised yet, so this is a left join
        // done in memory rather than a required lookup.
        const progressRows = await this.prisma.wordProgress.findMany({
            where: {
                userLoginId,
                wordId: { in: saved.map((row) => row.wordId) },
            },
            select: {
                wordId: true,
                nextReviewAt: true,
                totalReviews: true,
                correctReviews: true,
                isLeech: true,
                state: true,
                correctStreak: true,
            },
        });
        const progressByWordId = new Map(
            progressRows.map((row) => [row.wordId, row]),
        );

        const savedWords: SavedWordItemDto[] = saved.map((row) => {
            const progress = progressByWordId.get(row.wordId);
            const totalReviews = progress?.totalReviews ?? 0;
            return {
                wordId: row.wordId,
                note: row.note ?? undefined,
                savedAt: row.createdAt,
                nextReviewAt: progress?.nextReviewAt ?? null,
                successRate:
                    totalReviews > 0
                        ? Math.round(
                              ((progress?.correctReviews ?? 0) / totalReviews) *
                                  100 *
                                  10,
                          ) / 10
                        : 0,
                totalReviews,
                isLeech: progress?.isLeech ?? false,
                isSettled:
                    progress?.state === FSRS_STATE_REVIEW &&
                    progress.correctStreak >= RESCUE_CORRECT_STREAK,
            };
        });

        return { savedWords };
    }

    /** Drop saved words for deleted vocabulary (Kafka fan-out). */
    async deleteForWords(wordIds: string[]): Promise<void> {
        if (wordIds.length === 0) {
            return;
        }
        await this.prisma.savedWord.deleteMany({
            where: { wordId: { in: wordIds } },
        });
    }
}
