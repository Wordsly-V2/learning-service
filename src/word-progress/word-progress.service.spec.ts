// `uuid` v13 ships ESM only, which Jest's CJS runtime cannot load.
jest.mock('uuid', () => ({ v7: () => '00000000-0000-7000-8000-000000000000' }));

import { ConflictException } from '@nestjs/common';
import { State } from 'ts-fsrs';
import { AnswerQuality } from './dto/word-progress.dto';
import { formatClientDate } from '@/daily-habit/daily-habit-date.util';
import {
    WordProgressService,
    XP_ELIGIBLE_ANSWERS_PER_DAY,
} from './word-progress.service';

const WORD_A = '01936b3e-7c8f-7890-abcd-ef1234567890';
const WORD_B = '01936b3e-7c8f-7890-abcd-ef1234567891';
const USER = '01936c1e-1234-7890-abcd-ef1234567890';
const REQUEST_ID = '01936c1e-1234-7890-abcd-ef1234567899';

/** A minimal WordProgress row, as the upsert would return it. */
const progressRow = (wordId: string, overrides = {}) => ({
    id: 'row',
    wordId,
    userLoginId: USER,
    easeFactor: 5,
    interval: 1,
    repetitions: 1,
    stability: 1,
    state: State.Learning,
    lapses: 0,
    learningSteps: 0,
    correctStreak: 1,
    lastReviewedAt: new Date(),
    nextReviewAt: new Date(),
    totalReviews: 1,
    correctReviews: 1,
    isLeech: false,
    lapsesAtRescue: 0,
    rescuedCount: 0,
    suspendedAt: null,
    ...overrides,
});

describe('WordProgressService.recordAnswersBulk', () => {
    let prisma: {
        wordProgress: { findMany: jest.Mock; upsert: jest.Mock };
        dailyReviewStat: { findMany: jest.Mock; upsert: jest.Mock };
        dailyHabit: { findUnique: jest.Mock };
        syncRequest: {
            create: jest.Mock;
            update: jest.Mock;
            findUnique: jest.Mock;
        };
        $transaction: jest.Mock;
    };
    let awardXp: jest.Mock;
    let service: WordProgressService;
    /** Real SyncRequestService, so the P2002 replay path is exercised. */
    let syncRequests: {
        runOnce: (...args: never[]) => unknown;
    };

    const buildService = () => {
        awardXp = jest.fn().mockResolvedValue({ leveledUp: false });

        prisma = {
            wordProgress: {
                findMany: jest.fn().mockResolvedValue([]),
                upsert: jest.fn(
                    (args: {
                        where: { wordId_userLoginId: { wordId: string } };
                    }) =>
                        Promise.resolve(
                            progressRow(args.where.wordId_userLoginId.wordId),
                        ),
                ),
            },
            dailyReviewStat: {
                findMany: jest.fn().mockResolvedValue([]),
                upsert: jest.fn().mockResolvedValue({}),
            },
            dailyHabit: { findUnique: jest.fn().mockResolvedValue(null) },
            syncRequest: {
                create: jest.fn().mockResolvedValue({}),
                update: jest.fn().mockResolvedValue({}),
                findUnique: jest.fn().mockResolvedValue(null),
            },
            $transaction: jest.fn(
                (fn: (tx: typeof prisma) => unknown) => fn(prisma) as unknown,
            ),
        };

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { SyncRequestService } = require('@/sync/sync-request.service');
        syncRequests = new SyncRequestService(prisma) as typeof syncRequests;

        service = new WordProgressService(
            prisma as never,
            { awardXp } as never,
            {
                getSettings: jest.fn().mockResolvedValue({
                    leechThreshold: 8,
                    leechAutoSuspend: false,
                }),
            } as never,
            syncRequests as never,
        );
    };

    beforeEach(buildService);

    it('replays every answer for one word and returns a single row', async () => {
        const at = (minutes: number) =>
            new Date(Date.now() - (30 - minutes) * 60_000).toISOString();

        const result = await service.recordAnswersBulk(USER, {
            answers: [
                {
                    wordId: WORD_A,
                    quality: AnswerQuality.COMPLETE_BLACKOUT,
                    reviewedAt: at(0),
                },
                {
                    wordId: WORD_A,
                    quality: AnswerQuality.COMPLETE_BLACKOUT,
                    reviewedAt: at(11),
                },
                {
                    wordId: WORD_A,
                    quality: AnswerQuality.CORRECT_WITH_HESITATION,
                    reviewedAt: at(22),
                },
            ],
        });

        expect(prisma.wordProgress.upsert).toHaveBeenCalledTimes(3);
        expect(result.results).toHaveLength(1);
        expect(result.results[0].wordId).toBe(WORD_A);
    });

    it('writes one review-stat row per calendar date with the right deltas', async () => {
        const now = new Date();
        const day = (offset: number) =>
            new Date(now.getTime() - offset * 86_400_000).toISOString();

        await service.recordAnswersBulk(USER, {
            answers: [
                {
                    wordId: WORD_A,
                    quality: AnswerQuality.PERFECT,
                    reviewedAt: day(2),
                },
                {
                    wordId: WORD_A,
                    quality: AnswerQuality.COMPLETE_BLACKOUT,
                    reviewedAt: day(1),
                },
                {
                    wordId: WORD_B,
                    quality: AnswerQuality.PERFECT,
                    reviewedAt: day(0),
                },
            ],
            tzOffsetMinutes: 0,
            clientDate: formatClientDate(now),
        });

        expect(prisma.dailyReviewStat.upsert).toHaveBeenCalledTimes(3);

        const calls = prisma.dailyReviewStat.upsert.mock.calls.map(
            ([args]: [{ create: Record<string, number> }]) => args.create,
        );
        // WORD_A is new on the earliest day only; its second review two days
        // later is not a new word again.
        expect(calls.map((c) => c.newWords)).toEqual([1, 0, 1]);
        expect(calls.map((c) => c.reviews)).toEqual([1, 1, 1]);
        expect(calls.map((c) => c.correctReviews)).toEqual([1, 0, 1]);
    });

    it('clamps a batch reaching further back than the backdate limit', async () => {
        // The 14-day clamp is the binding constraint on how far a batch can
        // reach, so an absurdly old batch collapses into that window rather than
        // being rejected. MAX_BATCH_DATES sits above this on purpose — it is a
        // backstop, not the rule that fires here.
        const now = Date.now();
        const answers = Array.from({ length: 31 }, (_, index) => ({
            wordId: WORD_A,
            quality: AnswerQuality.PERFECT,
            reviewedAt: new Date(now - index * 86_400_000).toISOString(),
        }));

        await service.recordAnswersBulk(USER, {
            answers,
            tzOffsetMinutes: 0,
        });

        // 14 days back plus today, and every older answer folded onto the floor.
        expect(prisma.dailyReviewStat.upsert).toHaveBeenCalledTimes(15);
    });

    it('caps XP per day without capping the reviews themselves', async () => {
        const reviewedAt = new Date();
        const reviewDate = formatClientDate(reviewedAt);

        // Almost at the cap already from earlier sessions today.
        prisma.dailyReviewStat.findMany.mockResolvedValue([
            {
                reviewDate: new Date(`${reviewDate}T00:00:00.000Z`),
                reviews: XP_ELIGIBLE_ANSWERS_PER_DAY - 2,
            },
        ]);
        // Existing card, so no new-word XP muddies the arithmetic.
        prisma.wordProgress.findMany.mockResolvedValue([
            progressRow(WORD_A, { totalReviews: 5 }),
        ]);

        const answers = Array.from({ length: 5 }, (_, index) => ({
            wordId: WORD_A,
            quality: AnswerQuality.PERFECT,
            reviewedAt: new Date(
                reviewedAt.getTime() - (5 - index) * 1_000,
            ).toISOString(),
        }));

        await service.recordAnswersBulk(USER, {
            answers,
            tzOffsetMinutes: 0,
            clientDate: reviewDate,
        });

        // All five reviews are recorded...
        expect(prisma.wordProgress.upsert).toHaveBeenCalledTimes(5);
        const statCreate = prisma.dailyReviewStat.upsert.mock.calls[0][0]
            .create as { reviews: number };
        expect(statCreate.reviews).toBe(5);

        // ...but only the two that fit under the cap earn XP. A perfect answer on
        // an existing card is XP_PER_REVIEW + XP_CORRECT + XP_PERFECT = 6.
        const [, , xpAwarded] = awardXp.mock.calls[0] as [
            unknown,
            string,
            number,
        ];
        expect(xpAwarded).toBe(2 * 6);
    });

    it('does not touch the ledger when no clientRequestId is sent', async () => {
        await service.recordAnswersBulk(USER, {
            answers: [{ wordId: WORD_A, quality: AnswerQuality.PERFECT }],
        });

        expect(prisma.syncRequest.create).not.toHaveBeenCalled();
        expect(awardXp).toHaveBeenCalled();
    });

    it('replays the stored response without re-applying anything', async () => {
        const stored = {
            results: [{ wordId: WORD_A }],
            xpMultiplier: 1.25,
        };
        prisma.syncRequest.create.mockRejectedValue(
            Object.assign(
                new (require('@prisma/client').Prisma
                    .PrismaClientKnownRequestError)('dup', {
                    code: 'P2002',
                    clientVersion: 'test',
                }),
            ),
        );
        prisma.syncRequest.findUnique.mockResolvedValue({
            endpoint: 'word-progress.bulk-sync',
            response: stored,
        });

        const result = await service.recordAnswersBulk(USER, {
            answers: [{ wordId: WORD_A, quality: AnswerQuality.PERFECT }],
            clientRequestId: REQUEST_ID,
        });

        expect(result).toEqual({ ...stored, replayed: true });
        expect(awardXp).not.toHaveBeenCalled();
    });

    it('asks the client to retry while the original request is still in flight', async () => {
        prisma.syncRequest.create.mockRejectedValue(
            new (require('@prisma/client').Prisma.PrismaClientKnownRequestError)(
                'dup',
                { code: 'P2002', clientVersion: 'test' },
            ),
        );
        prisma.syncRequest.findUnique.mockResolvedValue({
            endpoint: 'word-progress.bulk-sync',
            response: null,
        });

        await expect(
            service.recordAnswersBulk(USER, {
                answers: [{ wordId: WORD_A, quality: AnswerQuality.PERFECT }],
                clientRequestId: REQUEST_ID,
            }),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(awardXp).not.toHaveBeenCalled();
    });
});
