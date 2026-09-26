// `uuid` v13 ships ESM only, which Jest's CJS runtime cannot load.
jest.mock('uuid', () => ({ v7: () => '00000000-0000-7000-8000-000000000000' }));

import { ConflictException } from '@nestjs/common';
import { ItemSource } from '@/word-scope/item-source';
import { State } from 'ts-fsrs';
import { AnswerQuality } from './dto/word-progress.dto';
import { formatClientDate } from '@/daily-habit/daily-habit-date.util';
import {
    WordProgressService,
    XP_ELIGIBLE_ANSWERS_PER_DAY,
} from './word-progress.service';

const WORD_A = '01936b3e-7c8f-7890-abcd-ef1234567890';
const WORD_B = '01936b3e-7c8f-7890-abcd-ef1234567891';
const WORD_C = '01936b3e-7c8f-7890-abcd-ef1234567892';
const WORD_D = '01936b3e-7c8f-7890-abcd-ef1234567893';
const WORD_E = '01936b3e-7c8f-7890-abcd-ef1234567894';
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

type ClaimRow = { practiceDate: Date; wordId: string };

describe('WordProgressService.recordAnswersBulk', () => {
    let prisma: {
        wordProgress: {
            findMany: jest.Mock;
            findUnique: jest.Mock;
            upsert: jest.Mock;
        };
        dailyReviewStat: { findMany: jest.Mock; upsert: jest.Mock };
        dailyPracticedWord: { createManyAndReturn: jest.Mock };
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
                findUnique: jest.fn().mockResolvedValue(null),
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
            // Nothing claimed yet, so every (date, word) in a batch is a first
            // touch and the insert hands every row back — which is what the
            // pre-ledger tests assume.
            dailyPracticedWord: {
                createManyAndReturn: jest.fn((args: { data: ClaimRow[] }) =>
                    Promise.resolve(args.data),
                ),
            },
            dailyHabit: { findUnique: jest.fn().mockResolvedValue(null) },
            syncRequest: {
                create: jest.fn().mockResolvedValue({}),
                update: jest.fn().mockResolvedValue({}),
                findUnique: jest.fn().mockResolvedValue(null),
            },
            $transaction: jest.fn((fn: (tx: typeof prisma) => unknown) =>
                fn(prisma),
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

    it('creates each card with the source its answer names, defaulting to vocab', async () => {
        await service.recordAnswersBulk(USER, {
            answers: [
                { wordId: WORD_A, quality: AnswerQuality.PERFECT },
                {
                    wordId: WORD_B,
                    quality: AnswerQuality.PERFECT,
                    source: 'path',
                },
            ],
        });

        const created = (
            prisma.wordProgress.upsert.mock.calls as [
                {
                    create: { wordId: string; source: ItemSource };
                    update: Record<string, unknown>;
                },
            ][]
        ).map(([args]) => args);
        expect(
            Object.fromEntries(
                created.map((args) => [args.create.wordId, args.create.source]),
            ),
        ).toEqual({ [WORD_A]: ItemSource.VOCAB, [WORD_B]: ItemSource.PATH });
        // An existing card never changes source.
        for (const args of created) {
            expect(args.update).not.toHaveProperty('source');
        }
        // Both were first sightings; only the Path one is exempt from the
        // new-word limit, so it is also counted separately.
        expect(prisma.dailyReviewStat.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: expect.objectContaining({
                    newWords: 2,
                    pathNewWords: 1,
                    reviews: 2,
                    pathReviews: 1,
                    correctReviews: 2,
                    pathCorrectReviews: 1,
                }),
            }),
        );
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
        // Existing cards, so no new-word XP muddies the arithmetic. Five
        // DISTINCT words, so it is the cap that binds here and not the
        // once-per-word-per-day ledger, which has its own test below.
        const words = [WORD_A, WORD_B, WORD_C, WORD_D, WORD_E];
        prisma.wordProgress.findMany.mockResolvedValue(
            words.map((wordId) => progressRow(wordId, { totalReviews: 5 })),
        );

        const answers = words.map((wordId, index) => ({
            wordId,
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

    it('pays a word once a day however many times the session answers it', async () => {
        const reviewedAt = new Date();
        const reviewDate = formatClientDate(reviewedAt);
        prisma.wordProgress.findMany.mockResolvedValue([
            progressRow(WORD_A, { totalReviews: 5 }),
        ]);

        const answers = Array.from({ length: 4 }, (_, index) => ({
            wordId: WORD_A,
            quality: AnswerQuality.PERFECT,
            reviewedAt: new Date(
                reviewedAt.getTime() - (4 - index) * 1_000,
            ).toISOString(),
        }));

        const result = await service.recordAnswersBulk(USER, {
            answers,
            tzOffsetMinutes: 0,
            clientDate: reviewDate,
        });

        // Every answer is still scheduled and counted...
        expect(prisma.wordProgress.upsert).toHaveBeenCalledTimes(4);
        const [[statUpsert]] = prisma.dailyReviewStat.upsert.mock.calls as [
            [{ create: { reviews: number } }],
        ];
        expect(statUpsert.create.reviews).toBe(4);

        // ...but only the first one is paid for, and the daily goal sees one
        // word, not four. A perfect answer on an existing card is 6 XP.
        const [, , xpAwarded] = awardXp.mock.calls[0] as [
            unknown,
            string,
            number,
        ];
        expect(xpAwarded).toBe(6);
        expect(result.countedWordsByDate).toEqual({ [reviewDate]: 1 });
    });

    it('pays nothing for a word already claimed earlier today', async () => {
        const reviewedAt = new Date();
        const reviewDate = formatClientDate(reviewedAt);
        prisma.wordProgress.findMany.mockResolvedValue([
            progressRow(WORD_A, { totalReviews: 5 }),
        ]);
        // ON CONFLICT DO NOTHING: the row exists, so nothing comes back.
        prisma.dailyPracticedWord.createManyAndReturn.mockResolvedValue([]);

        const result = await service.recordAnswersBulk(USER, {
            answers: [
                {
                    wordId: WORD_A,
                    quality: AnswerQuality.PERFECT,
                    reviewedAt: reviewedAt.toISOString(),
                },
            ],
            tzOffsetMinutes: 0,
            clientDate: reviewDate,
        });

        const [, , xpAwarded] = awardXp.mock.calls[0] as [
            unknown,
            string,
            number,
        ];
        expect(xpAwarded).toBe(0);
        expect(result.countedWordsByDate).toEqual({});
    });

    it('pays only for the claims its own insert actually won', async () => {
        const reviewedAt = new Date();
        const reviewDate = formatClientDate(reviewedAt);
        prisma.wordProgress.findMany.mockResolvedValue([
            progressRow(WORD_A, { totalReviews: 5 }),
            progressRow(WORD_B, { totalReviews: 5 }),
        ]);
        // A concurrent session claimed WORD_A between our read of the world
        // and our insert: ON CONFLICT skipped it, so only WORD_B came back.
        prisma.dailyPracticedWord.createManyAndReturn.mockImplementation(
            (args: { data: ClaimRow[] }) =>
                Promise.resolve(
                    args.data.filter((row) => row.wordId === WORD_B),
                ),
        );

        const result = await service.recordAnswersBulk(USER, {
            answers: [WORD_A, WORD_A, WORD_B].map((wordId, index) => ({
                wordId,
                quality: AnswerQuality.PERFECT,
                reviewedAt: new Date(
                    reviewedAt.getTime() - (3 - index) * 1_000,
                ).toISOString(),
            })),
            tzOffsetMinutes: 0,
            clientDate: reviewDate,
        });

        // One insert, one row per distinct (date, word), skipping conflicts.
        const [[insert]] = prisma.dailyPracticedWord.createManyAndReturn.mock
            .calls as [[{ data: ClaimRow[]; skipDuplicates: boolean }]];
        expect(insert.skipDuplicates).toBe(true);
        expect(insert.data.map((row) => row.wordId)).toEqual([WORD_A, WORD_B]);

        const [, , xpAwarded] = awardXp.mock.calls[0] as [
            unknown,
            string,
            number,
        ];
        expect(xpAwarded).toBe(6);
        expect(result.countedWordsByDate).toEqual({ [reviewDate]: 1 });
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
                new (require('@prisma/client').Prisma.PrismaClientKnownRequestError)(
                    'dup',
                    {
                        code: 'P2002',
                        clientVersion: 'test',
                    },
                ),
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

describe('WordProgressService.recordAnswer', () => {
    let prisma: {
        wordProgress: { findUnique: jest.Mock; upsert: jest.Mock };
        dailyReviewStat: { findMany: jest.Mock; upsert: jest.Mock };
        dailyPracticedWord: { createManyAndReturn: jest.Mock };
        dailyHabit: { findUnique: jest.Mock };
        $transaction: jest.Mock;
    };
    let awardXp: jest.Mock;
    let service: WordProgressService;

    const serverToday = () => formatClientDate(new Date());
    const daysFromToday = (offset: number) =>
        formatClientDate(new Date(Date.now() + offset * 86_400_000));
    const xpAwarded = () =>
        (awardXp.mock.calls[0] as [unknown, string, number])[2];

    beforeEach(() => {
        awardXp = jest.fn().mockResolvedValue({ leveledUp: false });
        prisma = {
            wordProgress: {
                // An existing card, so no new-word XP muddies the arithmetic.
                findUnique: jest
                    .fn()
                    .mockResolvedValue(
                        progressRow(WORD_A, { totalReviews: 5 }),
                    ),
                upsert: jest.fn(() => Promise.resolve(progressRow(WORD_A))),
            },
            dailyReviewStat: {
                findMany: jest.fn().mockResolvedValue([]),
                upsert: jest.fn().mockResolvedValue({}),
            },
            dailyPracticedWord: {
                createManyAndReturn: jest.fn((args: { data: ClaimRow[] }) =>
                    Promise.resolve(args.data),
                ),
            },
            dailyHabit: { findUnique: jest.fn().mockResolvedValue(null) },
            $transaction: jest.fn((fn: (tx: typeof prisma) => unknown) =>
                fn(prisma),
            ),
        };
        service = new WordProgressService(
            prisma as never,
            { awardXp } as never,
            {
                getSettings: jest.fn().mockResolvedValue({
                    leechThreshold: 8,
                    leechAutoSuspend: false,
                }),
            } as never,
            {} as never,
        );
    });

    const answer = (clientDate?: string) =>
        service.recordAnswer({
            wordId: WORD_A,
            quality: AnswerQuality.PERFECT,
            userLoginId: USER,
            clientDate,
        });

    it('counts a Path answer in the Path subsets of the day', async () => {
        await service.recordAnswer({
            wordId: WORD_A,
            quality: AnswerQuality.INCORRECT,
            userLoginId: USER,
            source: 'path',
        });
        await answer();

        const creates = (
            prisma.dailyReviewStat.upsert.mock.calls as [
                { create: Record<string, number> },
            ][]
        ).map(([args]) => args.create);
        expect(creates[0]).toMatchObject({
            reviews: 1,
            correctReviews: 0,
            pathReviews: 1,
            pathCorrectReviews: 0,
            pathNewWords: 0,
        });
        expect(creates[1]).toMatchObject({
            reviews: 1,
            correctReviews: 1,
            pathReviews: 0,
            pathCorrectReviews: 0,
        });
    });

    it('files a backdated clientDate under the server date, like the bulk path', async () => {
        await answer(daysFromToday(-10));

        const [[statUpsert]] = prisma.dailyReviewStat.upsert.mock.calls as [
            [{ create: { reviewDate: Date } }],
        ];
        expect(formatClientDate(statUpsert.create.reviewDate)).toBe(
            serverToday(),
        );
        const [[claim]] = prisma.dailyPracticedWord.createManyAndReturn.mock
            .calls as [[{ data: ClaimRow[] }]];
        expect(formatClientDate(claim.data[0].practiceDate)).toBe(
            serverToday(),
        );
    });

    it('keeps a clientDate within a day of the server date', async () => {
        const yesterday = daysFromToday(-1);
        await answer(yesterday);

        const [[statUpsert]] = prisma.dailyReviewStat.upsert.mock.calls as [
            [{ create: { reviewDate: Date } }],
        ];
        expect(formatClientDate(statUpsert.create.reviewDate)).toBe(yesterday);
    });

    it('stops paying XP once the day is at the cap, but still records the review', async () => {
        prisma.dailyReviewStat.findMany.mockResolvedValue([
            {
                reviewDate: new Date(`${serverToday()}T00:00:00.000Z`),
                reviews: XP_ELIGIBLE_ANSWERS_PER_DAY,
            },
        ]);

        await answer(serverToday());

        expect(prisma.wordProgress.upsert).toHaveBeenCalledTimes(1);
        expect(prisma.dailyReviewStat.upsert).toHaveBeenCalledTimes(1);
        expect(xpAwarded()).toBe(0);
    });

    it('still pays the last answer that fits under the cap', async () => {
        prisma.dailyReviewStat.findMany.mockResolvedValue([
            {
                reviewDate: new Date(`${serverToday()}T00:00:00.000Z`),
                reviews: XP_ELIGIBLE_ANSWERS_PER_DAY - 1,
            },
        ]);

        await answer(serverToday());

        // A perfect answer on an existing card is 6 XP.
        expect(xpAwarded()).toBe(6);
    });

    it('pays nothing when a concurrent session already claimed the word', async () => {
        prisma.dailyPracticedWord.createManyAndReturn.mockResolvedValue([]);

        await answer(serverToday());

        expect(xpAwarded()).toBe(0);
    });
});

describe('WordProgressService.getDueWordIds', () => {
    const SCOPE = [WORD_A, WORD_B, WORD_C, WORD_D];

    /**
     * Prisma double where the scope holds four words: A and B have cards and are
     * both due, C and D have never been studied.
     */
    const buildService = (settings: {
        dailyNewWordLimit: number;
        dailyReviewLimit: number;
        today?: { reviews: number; newWords: number };
    }) => {
        const dueRows = [{ wordId: WORD_A }, { wordId: WORD_B }];
        const prisma = {
            wordProgress: {
                findMany: jest.fn(
                    (args: { orderBy?: unknown; take?: number }) =>
                        Promise.resolve(
                            args.orderBy
                                ? dueRows.slice(0, args.take)
                                : dueRows,
                        ),
                ),
                count: jest.fn().mockResolvedValue(dueRows.length),
            },
            dailyReviewStat: {
                findUnique: jest.fn().mockResolvedValue(settings.today ?? null),
            },
        };
        const service = new WordProgressService(
            prisma as never,
            {} as never,
            {
                getSettings: jest.fn().mockResolvedValue({
                    dailyNewWordLimit: settings.dailyNewWordLimit,
                    dailyReviewLimit: settings.dailyReviewLimit,
                }),
            } as never,
            {} as never,
        );
        return { service, prisma };
    };

    it('labels the due and new halves and reports the uncapped totals', async () => {
        const { service } = buildService({
            dailyNewWordLimit: 10,
            dailyReviewLimit: 100,
        });

        const result = await service.getDueWordIds(USER, {
            wordIds: SCOPE,
            limit: 20,
            newLimit: 5,
            includeNew: true,
        });

        expect(result.dueWordIds).toEqual([WORD_A, WORD_B]);
        expect(result.newWordIds).toEqual([WORD_C, WORD_D]);
        expect(result.wordIds).toEqual([WORD_A, WORD_B, WORD_C, WORD_D]);
        expect(result.dueTotal).toBe(2);
        expect(result.newTotal).toBe(2);
    });

    it('breaks nextReviewAt ties on wordId so repeated calls agree', async () => {
        const { service, prisma } = buildService({
            dailyNewWordLimit: 10,
            dailyReviewLimit: 100,
        });

        await service.getDueWordIds(USER, { wordIds: SCOPE, limit: 20 });

        const dueQuery = prisma.wordProgress.findMany.mock.calls
            .map((call) => call[0] as { orderBy?: unknown })
            .find((args) => args.orderBy);
        expect(dueQuery?.orderBy).toEqual([
            { nextReviewAt: 'asc' },
            { wordId: 'asc' },
        ]);
    });

    it('never returns more words than the session asked for', async () => {
        const { service } = buildService({
            dailyNewWordLimit: 10,
            dailyReviewLimit: 100,
        });

        // Two due words fill a session of two, so newLimit buys nothing extra —
        // this is what used to hand back 2 + 5 for a "2 words per session".
        const result = await service.getDueWordIds(USER, {
            wordIds: SCOPE,
            limit: 2,
            newLimit: 5,
            includeNew: true,
        });

        expect(result.wordIds).toHaveLength(2);
        expect(result.newWordIds).toEqual([]);
        // The totals still tell the UI what is being held back.
        expect(result.newTotal).toBe(2);
    });

    it('does not spend the review budget on words learned today', async () => {
        const { service } = buildService({
            dailyNewWordLimit: 10,
            dailyReviewLimit: 6,
            // Six answers today, five of them first sightings of new words.
            today: { reviews: 6, newWords: 5 },
        });

        const result = await service.getDueWordIds(USER, {
            wordIds: SCOPE,
            limit: 20,
            includeNew: false,
        });

        // One genuine review today, so five review slots are left — not zero.
        expect(result.pacing?.reviewsRemainingToday).toBe(5);
        expect(result.dueWordIds).toEqual([WORD_A, WORD_B]);
    });

    it('scopes a Path review by source: no id list, no new items', async () => {
        const { service, prisma } = buildService({
            dailyNewWordLimit: 10,
            dailyReviewLimit: 100,
        });

        const result = await service.getDueWordIds(
            USER,
            { wordIds: [], limit: 20, includeNew: true },
            ItemSource.PATH,
        );

        const dueQuery = prisma.wordProgress.findMany.mock.calls
            .map((call) => call[0] as { where: object; orderBy?: unknown })
            .find((args) => args.orderBy);
        expect(dueQuery?.where).toMatchObject({ source: ItemSource.PATH });
        expect(dueQuery?.where).not.toHaveProperty('wordId');
        expect(result.dueWordIds).toEqual([WORD_A, WORD_B]);
        // Path items are introduced by lessons, never by the review queue.
        expect(result.newWordIds).toEqual([]);
        expect(result.newTotal).toBe(0);
    });
});

describe('WordProgressService.deletePathProgressForItems', () => {
    const build = () => {
        const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
        const service = new WordProgressService(
            { wordProgress: { deleteMany } } as never,
            {} as never,
            {} as never,
            {} as never,
        );
        return { service, deleteMany };
    };

    it('deletes only Path cards for the items', async () => {
        const { service, deleteMany } = build();
        await service.deletePathProgressForItems([WORD_A]);
        expect(deleteMany).toHaveBeenCalledWith({
            where: { wordId: { in: [WORD_A] }, source: 'PATH' },
        });
    });

    it('never runs an unfiltered delete for an empty list', async () => {
        const { service, deleteMany } = build();
        await service.deletePathProgressForItems([]);
        expect(deleteMany).not.toHaveBeenCalled();
    });
});
