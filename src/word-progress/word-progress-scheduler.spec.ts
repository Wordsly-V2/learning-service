import { Rating } from 'ts-fsrs';
import { AnswerQuality } from './dto/word-progress.dto';
import {
    answerQualityToFsrsRating,
    calculateNextReview,
    calculateNextReviewSm2,
    FIRST_LEARNING_STEP_MINUTES,
    INTRADAY_INTERVAL,
    MAX_INTERVAL_DAYS,
    sm2EaseToFsrsDifficulty,
    toSchedulerInput,
    type WordProgressSchedulerInput,
} from './word-progress-scheduler';

const NOW = new Date('2026-06-07T10:00:00.000Z');

function emptyInput(
    overrides: Partial<WordProgressSchedulerInput> = {},
): WordProgressSchedulerInput {
    return {
        easeFactor: 2.5,
        interval: 0,
        repetitions: 0,
        stability: 0,
        totalReviews: 0,
        lastReviewedAt: null,
        nextReviewAt: NOW,
        ...overrides,
    };
}

describe('toSchedulerInput', () => {
    it('defaults stability to 0 when omitted on legacy rows', () => {
        const result = toSchedulerInput(
            {
                easeFactor: 2.5,
                interval: 6,
                repetitions: 3,
                totalReviews: 5,
                lastReviewedAt: NOW,
                nextReviewAt: NOW,
            },
            NOW,
        );

        expect(result.stability).toBe(0);
    });
});

describe('answerQualityToFsrsRating', () => {
    it('maps incorrect answers to Again', () => {
        expect(answerQualityToFsrsRating(AnswerQuality.COMPLETE_BLACKOUT)).toBe(
            Rating.Again,
        );
        expect(answerQualityToFsrsRating(AnswerQuality.INCORRECT)).toBe(
            Rating.Again,
        );
        expect(
            answerQualityToFsrsRating(AnswerQuality.INCORRECT_BUT_EASY),
        ).toBe(Rating.Again);
    });

    it('maps correct answers to Hard, Good, Easy', () => {
        expect(
            answerQualityToFsrsRating(AnswerQuality.CORRECT_WITH_DIFFICULTY),
        ).toBe(Rating.Hard);
        expect(
            answerQualityToFsrsRating(AnswerQuality.CORRECT_WITH_HESITATION),
        ).toBe(Rating.Good);
        expect(answerQualityToFsrsRating(AnswerQuality.PERFECT)).toBe(
            Rating.Easy,
        );
    });
});

describe('sm2EaseToFsrsDifficulty', () => {
    it('maps low SM-2 ease to high FSRS difficulty', () => {
        expect(sm2EaseToFsrsDifficulty(1.3)).toBeCloseTo(10, 1);
        expect(sm2EaseToFsrsDifficulty(3.0)).toBeCloseTo(3, 1);
    });
});

describe('calculateNextReviewSm2', () => {
    it('schedules intraday follow-up after first correct answer', () => {
        const result = calculateNextReviewSm2(
            AnswerQuality.PERFECT,
            2.5,
            0,
            0,
            NOW,
        );

        expect(result.repetitions).toBe(1);
        expect(result.interval).toBe(INTRADAY_INTERVAL);
        expect(result.nextReviewAt.getTime() - NOW.getTime()).toBe(
            FIRST_LEARNING_STEP_MINUTES * 60 * 1000,
        );
    });

    it('resets repetitions on failed answer', () => {
        const result = calculateNextReviewSm2(
            AnswerQuality.INCORRECT,
            2.5,
            6,
            4,
            NOW,
        );

        expect(result.repetitions).toBe(0);
        expect(result.interval).toBe(1);
    });

    it('caps interval at MAX_INTERVAL_DAYS', () => {
        const result = calculateNextReviewSm2(
            AnswerQuality.PERFECT,
            2.5,
            50,
            5,
            NOW,
        );

        expect(result.interval).toBeLessThanOrEqual(MAX_INTERVAL_DAYS);
    });
});

describe('calculateNextReview (fsrs)', () => {
    it('schedules a future review for a new word answered correctly', () => {
        const result = calculateNextReview(
            'fsrs',
            AnswerQuality.CORRECT_WITH_HESITATION,
            emptyInput(),
            NOW,
        );

        expect(result.repetitions).toBe(1);
        expect(result.stability).toBeGreaterThan(0);
        expect(result.nextReviewAt.getTime()).toBeGreaterThan(NOW.getTime());
    });

    it('schedules intraday relearning after a failed answer on a new word', () => {
        const result = calculateNextReview(
            'fsrs',
            AnswerQuality.INCORRECT,
            emptyInput(),
            NOW,
        );

        const deltaMs = result.nextReviewAt.getTime() - NOW.getTime();
        expect(deltaMs).toBeGreaterThan(0);
        expect(deltaMs).toBeLessThanOrEqual(
            FIRST_LEARNING_STEP_MINUTES * 60 * 1000 + 1000,
        );
    });

    it('preserves FSRS stability across consecutive reviews', () => {
        const first = calculateNextReview(
            'fsrs',
            AnswerQuality.CORRECT_WITH_HESITATION,
            emptyInput(),
            NOW,
        );

        const second = calculateNextReview(
            'fsrs',
            AnswerQuality.CORRECT_WITH_HESITATION,
            emptyInput({
                easeFactor: first.easeFactor,
                interval: first.interval,
                repetitions: first.repetitions,
                stability: first.stability,
                totalReviews: 1,
                lastReviewedAt: NOW,
                nextReviewAt: first.nextReviewAt,
            }),
            first.nextReviewAt,
        );

        expect(second.stability).toBeGreaterThan(first.stability);
        expect(second.repetitions).toBe(2);
    });

    it('migrates legacy SM-2 progress without stability', () => {
        const result = calculateNextReview(
            'fsrs',
            AnswerQuality.PERFECT,
            emptyInput({
                easeFactor: 2.5,
                interval: 6,
                repetitions: 3,
                totalReviews: 5,
                lastReviewedAt: new Date('2026-06-01T10:00:00.000Z'),
                nextReviewAt: NOW,
            }),
            NOW,
        );

        expect(result.stability).toBeGreaterThan(0);
        expect(result.nextReviewAt.getTime()).toBeGreaterThan(NOW.getTime());
    });

    it('caps FSRS interval at MAX_INTERVAL_DAYS', () => {
        let input = emptyInput({
            easeFactor: 3,
            interval: 40,
            repetitions: 10,
            stability: 45,
            totalReviews: 15,
            lastReviewedAt: new Date('2026-05-01T10:00:00.000Z'),
            nextReviewAt: NOW,
        });
        let now = NOW;

        for (let i = 0; i < 5; i++) {
            const result = calculateNextReview(
                'fsrs',
                AnswerQuality.PERFECT,
                input,
                now,
            );
            expect(result.interval).toBeLessThanOrEqual(MAX_INTERVAL_DAYS);
            input = {
                ...input,
                easeFactor: result.easeFactor,
                interval: result.interval,
                repetitions: result.repetitions,
                stability: result.stability,
                totalReviews: input.totalReviews + 1,
                lastReviewedAt: now,
                nextReviewAt: result.nextReviewAt,
            };
            now = result.nextReviewAt;
        }
    });
});

describe('calculateNextReview algorithm selection', () => {
    it('uses SM-2 when algorithm is sm2', () => {
        const sm2 = calculateNextReview(
            'sm2',
            AnswerQuality.PERFECT,
            emptyInput(),
            NOW,
        );
        const direct = calculateNextReviewSm2(
            AnswerQuality.PERFECT,
            2.5,
            0,
            0,
            NOW,
        );

        expect(sm2).toEqual(direct);
    });
});
