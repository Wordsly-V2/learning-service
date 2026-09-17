import { SavedWordService } from './saved-word.service';
import { FSRS_STATE_REVIEW } from '@/word-progress/leech.logic';

const USER = '01936c1e-1234-7890-abcd-ef1234567890';
const WORD_A = '01936b3e-7c8f-7890-abcd-ef1234567890';
const WORD_B = '01936b3e-7c8f-7890-abcd-ef1234567891';

const buildService = () => {
    const prisma = {
        savedWord: {
            upsert: jest.fn().mockResolvedValue({}),
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
            findMany: jest.fn().mockResolvedValue([]),
        },
        wordProgress: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { prisma, service: new SavedWordService(prisma as never) };
};

const savedRow = (wordId: string, note?: string) => ({
    userLoginId: USER,
    wordId,
    note: note ?? null,
    createdAt: new Date('2026-09-17T09:00:00.000Z'),
});

describe('SavedWordService', () => {
    it('upserts so flagging an already-saved word is not an error', async () => {
        const { prisma, service } = buildService();
        await service.save(USER, WORD_A, 'mixed up with "affect"');

        expect(prisma.savedWord.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    userLoginId_wordId: { userLoginId: USER, wordId: WORD_A },
                },
                create: {
                    userLoginId: USER,
                    wordId: WORD_A,
                    note: 'mixed up with "affect"',
                },
            }),
        );
    });

    it('lists a saved word that has never been practised', async () => {
        const { prisma, service } = buildService();
        prisma.savedWord.findMany.mockResolvedValue([
            savedRow(WORD_A, 'tricky'),
        ]);

        const { savedWords } = await service.list(USER);

        expect(savedWords).toEqual([
            expect.objectContaining({
                wordId: WORD_A,
                note: 'tricky',
                nextReviewAt: null,
                totalReviews: 0,
                successRate: 0,
                isLeech: false,
                isSettled: false,
            }),
        ]);
    });

    it('joins progress on and reports the settled bar', async () => {
        const { prisma, service } = buildService();
        prisma.savedWord.findMany.mockResolvedValue([
            savedRow(WORD_A),
            savedRow(WORD_B),
        ]);
        prisma.wordProgress.findMany.mockResolvedValue([
            {
                wordId: WORD_A,
                nextReviewAt: new Date('2026-09-27T00:00:00.000Z'),
                totalReviews: 8,
                correctReviews: 5,
                isLeech: true,
                state: FSRS_STATE_REVIEW,
                correctStreak: 3,
            },
        ]);

        const { savedWords } = await service.list(USER);

        expect(savedWords[0]).toEqual(
            expect.objectContaining({
                wordId: WORD_A,
                successRate: 62.5,
                isLeech: true,
                isSettled: true,
            }),
        );
        // WORD_B has no progress row — a left join, not a filter.
        expect(savedWords[1].wordId).toBe(WORD_B);
        expect(savedWords[1].isSettled).toBe(false);
    });

    it('is not settled on a short correct run', async () => {
        const { prisma, service } = buildService();
        prisma.savedWord.findMany.mockResolvedValue([savedRow(WORD_A)]);
        prisma.wordProgress.findMany.mockResolvedValue([
            {
                wordId: WORD_A,
                nextReviewAt: new Date(),
                totalReviews: 4,
                correctReviews: 2,
                isLeech: false,
                state: FSRS_STATE_REVIEW,
                correctStreak: 2,
            },
        ]);

        const { savedWords } = await service.list(USER);
        expect(savedWords[0].isSettled).toBe(false);
    });

    it('short-circuits an empty scope without querying', async () => {
        const { prisma, service } = buildService();
        expect(await service.list(USER, [])).toEqual({ savedWords: [] });
        expect(prisma.savedWord.findMany).not.toHaveBeenCalled();
    });

    it('does nothing when Kafka reports no words', async () => {
        const { prisma, service } = buildService();
        await service.deleteForWords([]);
        expect(prisma.savedWord.deleteMany).not.toHaveBeenCalled();
    });
});
