import {
    createEmptyCard,
    dateDiffInDays,
    fsrs,
    Rating,
    State,
    type Card,
    type Grade,
} from 'ts-fsrs';
import { AnswerQuality } from './dto/word-progress.dto';

/** Maximum interval in days — caps next review so words don't disappear for years. */
export const MAX_INTERVAL_DAYS = 60;

/**
 * Intraday learning step before day-based intervals (Anki-style).
 * Research: 5–7 retrieval rounds strengthen form–meaning links (Nakata 2017).
 */
export const FIRST_LEARNING_STEP_MINUTES = 10;

/** interval === 0 means use FIRST_LEARNING_STEP_MINUTES instead of days. */
export const INTRADAY_INTERVAL = 0;

export type SpacedRepetitionAlgorithm = 'fsrs' | 'sm2';

export interface WordProgressSchedulerInput {
    easeFactor: number;
    interval: number;
    repetitions: number;
    stability: number;
    totalReviews: number;
    lastReviewedAt: Date | null;
    nextReviewAt: Date;
}

/** DB row fields consumed by the scheduler. Stability is optional on legacy rows. */
export type WordProgressStoredState = Omit<
    WordProgressSchedulerInput,
    'stability'
> &
    Partial<Pick<WordProgressSchedulerInput, 'stability'>>;

export function toSchedulerInput(
    progress: WordProgressStoredState | null,
    now: Date = new Date(),
): WordProgressSchedulerInput {
    if (!progress) {
        return {
            easeFactor: 2.5,
            interval: 0,
            repetitions: 0,
            stability: 0,
            totalReviews: 0,
            lastReviewedAt: null,
            nextReviewAt: now,
        };
    }

    return {
        easeFactor: progress.easeFactor,
        interval: progress.interval,
        repetitions: progress.repetitions,
        stability: progress.stability ?? 0,
        totalReviews: progress.totalReviews,
        lastReviewedAt: progress.lastReviewedAt,
        nextReviewAt: progress.nextReviewAt,
    };
}

export interface SpacedRepetitionResult {
    easeFactor: number;
    interval: number;
    repetitions: number;
    stability: number;
    nextReviewAt: Date;
}

const wordslyFsrs = fsrs({
    request_retention: 0.9,
    maximum_interval: MAX_INTERVAL_DAYS,
    enable_fuzz: false,
    enable_short_term: true,
    learning_steps: [`${FIRST_LEARNING_STEP_MINUTES}m`],
    relearning_steps: [`${FIRST_LEARNING_STEP_MINUTES}m`],
});

/** Map Wordsly AnswerQuality (0–5, SM-2 scale) to FSRS grades. */
export function answerQualityToFsrsRating(quality: AnswerQuality): Grade {
    if (quality < AnswerQuality.CORRECT_WITH_DIFFICULTY) {
        return Rating.Again;
    }
    if (quality === AnswerQuality.CORRECT_WITH_DIFFICULTY) {
        return Rating.Hard;
    }
    if (quality === AnswerQuality.CORRECT_WITH_HESITATION) {
        return Rating.Good;
    }
    return Rating.Easy;
}

/** Convert legacy SM-2 ease factor (1.3–3.0) to FSRS difficulty (~1–10). */
export function sm2EaseToFsrsDifficulty(easeFactor: number): number {
    const clamped = Math.max(1.3, Math.min(3.0, easeFactor));
    return 10 - ((clamped - 1.3) / 1.7) * 7;
}

function inferFsrsState(input: WordProgressSchedulerInput): State {
    if (input.totalReviews === 0) {
        return State.New;
    }
    if (input.repetitions === 0) {
        return State.Relearning;
    }
    if (input.repetitions < 3 || input.interval === INTRADAY_INTERVAL) {
        return State.Learning;
    }
    return State.Review;
}

export function wordProgressToFsrsCard(
    input: WordProgressSchedulerInput,
    now: Date,
): Card {
    if (input.totalReviews === 0) {
        return createEmptyCard(now);
    }

    const difficulty =
        input.stability > 0
            ? input.easeFactor
            : sm2EaseToFsrsDifficulty(input.easeFactor);
    const stability =
        input.stability > 0 ? input.stability : Math.max(input.interval, 0.001);

    return {
        due: input.nextReviewAt,
        stability,
        difficulty,
        elapsed_days: input.lastReviewedAt
            ? dateDiffInDays(input.lastReviewedAt, now)
            : 0,
        scheduled_days: input.interval,
        learning_steps: 0,
        reps: input.repetitions,
        lapses: 0,
        state: inferFsrsState(input),
        last_review: input.lastReviewedAt ?? undefined,
    };
}

export function fsrsCardToProgress(
    card: Card,
    now: Date,
): SpacedRepetitionResult {
    const interval =
        card.scheduled_days > 0
            ? Math.min(Math.round(card.scheduled_days), MAX_INTERVAL_DAYS)
            : INTRADAY_INTERVAL;

    let nextReviewAt = new Date(card.due);
    if (nextReviewAt <= now) {
        nextReviewAt = new Date(now);
        if (interval === INTRADAY_INTERVAL) {
            nextReviewAt.setMinutes(
                nextReviewAt.getMinutes() + FIRST_LEARNING_STEP_MINUTES,
            );
        } else {
            nextReviewAt.setDate(
                nextReviewAt.getDate() + Math.max(interval, 1),
            );
        }
    }

    return {
        easeFactor: card.difficulty,
        interval,
        repetitions: card.reps,
        stability: card.stability,
        nextReviewAt,
    };
}

export function calculateNextReviewFsrs(
    quality: AnswerQuality,
    input: WordProgressSchedulerInput,
    now: Date,
): SpacedRepetitionResult {
    const card = wordProgressToFsrsCard(input, now);
    const rating = answerQualityToFsrsRating(quality);
    const { card: nextCard } = wordslyFsrs.next(card, now, rating);
    return fsrsCardToProgress(nextCard, now);
}

export function calculateNextReviewSm2(
    quality: AnswerQuality,
    easeFactor: number,
    interval: number,
    repetitions: number,
    now: Date,
): SpacedRepetitionResult {
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
            newInterval = INTRADAY_INTERVAL;
        } else if (newRepetitions === 2) {
            newInterval = 1;
        } else if (newRepetitions === 3) {
            newInterval = 6;
        } else {
            newInterval = Math.round(interval * newEaseFactor);
            if (newInterval > MAX_INTERVAL_DAYS) {
                newInterval = MAX_INTERVAL_DAYS;
            }
        }
    }

    const nextReviewAt = scheduleNextReviewAtSm2(
        now,
        newRepetitions,
        newInterval,
    );

    return {
        easeFactor: newEaseFactor,
        interval: newInterval,
        repetitions: newRepetitions,
        stability: 0,
        nextReviewAt,
    };
}

export function scheduleNextReviewAtSm2(
    now: Date,
    repetitions: number,
    intervalDays: number,
): Date {
    const nextReviewAt = new Date(now);
    if (repetitions === 1 && intervalDays === INTRADAY_INTERVAL) {
        nextReviewAt.setMinutes(
            nextReviewAt.getMinutes() + FIRST_LEARNING_STEP_MINUTES,
        );
        return nextReviewAt;
    }
    nextReviewAt.setDate(nextReviewAt.getDate() + intervalDays);
    return nextReviewAt;
}

export function calculateNextReview(
    algorithm: SpacedRepetitionAlgorithm,
    quality: AnswerQuality,
    input: WordProgressSchedulerInput,
    now: Date,
): SpacedRepetitionResult {
    if (algorithm === 'fsrs') {
        return calculateNextReviewFsrs(quality, input, now);
    }
    return calculateNextReviewSm2(
        quality,
        input.easeFactor,
        input.interval,
        input.repetitions,
        now,
    );
}
