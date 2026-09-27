import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { SavedWordItemDto, SavedWordsResponseDto } from './dto/saved-word.dto';
import {
    FSRS_STATE_REVIEW,
    RESCUE_CORRECT_STREAK,
} from '@/word-progress/leech.logic';
import {
    ItemSource,
    type ItemSourceParam,
    toItemSource,
    toItemSourceParam,
} from '@/word-scope/item-source';

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
        source?: ItemSourceParam,
    ): Promise<void> {
        await this.prisma.savedWord.upsert({
            where: { userLoginId_wordId: { userLoginId, wordId } },
            // `source` only on create: an id belongs to exactly one service.
            create: { userLoginId, wordId, note, source: toItemSource(source) },
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
     * @param source only flags from this source; `undefined` means both.
     */
    async list(
        userLoginId: string,
        wordIds?: string[],
        source?: ItemSourceParam,
    ): Promise<SavedWordsResponseDto> {
        if (wordIds?.length === 0) {
            return { savedWords: [] };
        }

        const saved = await this.prisma.savedWord.findMany({
            where: {
                userLoginId,
                ...(wordIds && { wordId: { in: wordIds } }),
                ...(source && { source: toItemSource(source) }),
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
                source: true,
                nextReviewAt: true,
                totalReviews: true,
                correctReviews: true,
                isLeech: true,
                state: true,
                correctStreak: true,
            },
        });
        // Keyed by source too: a flag only reads progress of its own kind.
        const progressByKey = new Map(
            progressRows.map((row) => [`${row.source}:${row.wordId}`, row]),
        );

        const savedWords: SavedWordItemDto[] = saved.map((row) => {
            const progress = progressByKey.get(`${row.source}:${row.wordId}`);
            const totalReviews = progress?.totalReviews ?? 0;
            return {
                wordId: row.wordId,
                source: toItemSourceParam(row.source),
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
        await this.deleteForSource(wordIds, ItemSource.VOCAB);
    }

    /** Drop saved Path items that a release retired (Kafka fan-out). */
    async deleteForPathItems(itemIds: string[]): Promise<void> {
        await this.deleteForSource(itemIds, ItemSource.PATH);
    }

    /**
     * Ids never collide across services, but the source filter keeps a bad
     * message on one topic from touching the other kind's flags.
     */
    private async deleteForSource(
        ids: string[],
        source: ItemSource,
    ): Promise<void> {
        // `{ in: undefined }` is no filter at all, so guard the empty case.
        if (!Array.isArray(ids) || ids.length === 0) {
            return;
        }
        await this.prisma.savedWord.deleteMany({
            where: { wordId: { in: ids }, source },
        });
    }
}
