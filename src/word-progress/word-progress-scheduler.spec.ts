import { Rating, State } from 'ts-fsrs';
import { AnswerQuality } from './dto/word-progress.dto';
import {
    answerQualityToFsrsRating,
    calculateNextReview,
    FIRST_LEARNING_STEP_MINUTES,
    MAX_INTERVAL_DAYS,
    sm2EaseToFsrsDifficulty,
    toSchedulerInput,
    type SpacedRepetitionResult,
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
        state: State.New,
        lapses: 0,
        learningSteps: 0,
        ...overrides,
    };
}

/** Feed a scheduler result back in as the next review's stored state. */
function asNextInput(
    result: SpacedRepetitionResult,
    prev: WordProgressSchedulerInput,
): WordProgressSchedulerInput {
    return {
        ...prev,
        easeFactor: result.easeFactor,
        interval: result.interval,
        repetitions: result.repetitions,
        stability: result.stability,
        state: result.state,
        lapses: result.lapses,
        learningSteps: result.learningSteps,
        totalReviews: prev.totalReviews + 1,
        lastReviewedAt: prev.nextReviewAt,
        nextReviewAt: result.nextReviewAt,
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

describe('calculateNextReview', () => {
    it('schedules a future review for a new word answered correctly', () => {
        const result = calculateNextReview(
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
        const firstInput = emptyInput();
        const first = calculateNextReview(
            AnswerQuality.CORRECT_WITH_HESITATION,
            firstInput,
            NOW,
        );

        const second = calculateNextReview(
            AnswerQuality.CORRECT_WITH_HESITATION,
            asNextInput(first, firstInput),
            first.nextReviewAt,
        );

        expect(second.stability).toBeGreaterThan(first.stability);
        expect(second.repetitions).toBe(2);
    });

    it('migrates legacy SM-2 progress without stability', () => {
        const result = calculateNextReview(
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

    it('persists FSRS state across the round-trip instead of inferring it', () => {
        // Drive a card with repeated good answers; it should reach Review state
        // and that state must survive being decomposed to DB fields and rebuilt.
        let input = emptyInput();
        let now = NOW;
        let last: SpacedRepetitionResult | null = null;

        for (let i = 0; i < 6; i++) {
            const result = calculateNextReview(
                AnswerQuality.PERFECT,
                input,
                now,
            );
            input = asNextInput(result, input);
            now = result.nextReviewAt;
            last = result;
        }

        expect(last!.state).toBe(State.Review);
    });

    it('accumulates lapses across reviews instead of resetting them to 0', () => {
        // Graduate the card to Review so that an Again answer counts as a lapse.
        let input = emptyInput();
        let now = NOW;
        for (let i = 0; i < 6; i++) {
            const result = calculateNextReview(
                AnswerQuality.PERFECT,
                input,
                now,
            );
            input = asNextInput(result, input);
            now = result.nextReviewAt;
        }
        expect(input.state).toBe(State.Review);
        expect(input.lapses).toBe(0);

        // First failure on a Review card → one lapse, persisted on the result.
        const firstLapse = calculateNextReview(
            AnswerQuality.COMPLETE_BLACKOUT,
            input,
            now,
        );
        expect(firstLapse.lapses).toBe(1);

        // Feed it back, graduate again, then fail again — lapses must keep
        // climbing (the old round-trip hardcoded lapses to 0 every review).
        input = asNextInput(firstLapse, input);
        now = firstLapse.nextReviewAt;
        for (let i = 0; i < 6; i++) {
            const result = calculateNextReview(
                AnswerQuality.PERFECT,
                input,
                now,
            );
            input = asNextInput(result, input);
            now = result.nextReviewAt;
        }
        const secondLapse = calculateNextReview(
            AnswerQuality.COMPLETE_BLACKOUT,
            input,
            now,
        );
        expect(secondLapse.lapses).toBe(2);
    });

    it('treats legacy SM-2 rows (no FSRS state) as inferred, starting lapses at 0', () => {
        const result = calculateNextReview(
            AnswerQuality.COMPLETE_BLACKOUT,
            emptyInput({
                easeFactor: 2.5,
                interval: 6,
                repetitions: 3,
                stability: 0, // legacy marker
                state: null,
                lapses: 99, // ignored for legacy rows
                totalReviews: 5,
                lastReviewedAt: new Date('2026-06-01T10:00:00.000Z'),
                nextReviewAt: NOW,
            }),
            NOW,
        );

        // Legacy rows have no FSRS lapse history; the failed answer produces the
        // first lapse rather than carrying the bogus stored value forward.
        expect(result.lapses).toBe(1);
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
