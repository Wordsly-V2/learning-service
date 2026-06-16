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

export interface WordProgressSchedulerInput {
    easeFactor: number;
    interval: number;
    repetitions: number;
    stability: number;
    totalReviews: number;
    lastReviewedAt: Date | null;
    nextReviewAt: Date;
    /** Persisted FSRS State enum value; null on legacy rows (inferred instead). */
    state: number | null;
    lapses: number;
    learningSteps: number;
}

/**
 * DB row fields consumed by the scheduler. Stability and the full FSRS card
 * state (state/lapses/learningSteps) are optional on legacy SM-2 rows.
 */
export type WordProgressStoredState = Omit<
    WordProgressSchedulerInput,
    'stability' | 'state' | 'lapses' | 'learningSteps'
> &
    Partial<
        Pick<
            WordProgressSchedulerInput,
            'stability' | 'state' | 'lapses' | 'learningSteps'
        >
    >;

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
            state: State.New,
            lapses: 0,
            learningSteps: 0,
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
        state: progress.state ?? null,
        lapses: progress.lapses ?? 0,
        learningSteps: progress.learningSteps ?? 0,
    };
}

export interface SpacedRepetitionResult {
    easeFactor: number;
    interval: number;
    repetitions: number;
    stability: number;
    nextReviewAt: Date;
    state: number;
    lapses: number;
    learningSteps: number;
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

    // FSRS-native rows (stability > 0) carry full persisted card state, so we
    // reconstruct the card losslessly. Legacy SM-2 rows (stability === 0) have
    // no FSRS history, so we infer state and start lapse/step counters at 0.
    const isFsrsNative = input.stability > 0;

    const difficulty = isFsrsNative
        ? input.easeFactor
        : sm2EaseToFsrsDifficulty(input.easeFactor);
    const stability = isFsrsNative
        ? input.stability
        : Math.max(input.interval, 0.001);

    return {
        due: input.nextReviewAt,
        stability,
        difficulty,
        elapsed_days: input.lastReviewedAt
            ? dateDiffInDays(input.lastReviewedAt, now)
            : 0,
        scheduled_days: input.interval,
        learning_steps: isFsrsNative ? input.learningSteps : 0,
        reps: input.repetitions,
        lapses: isFsrsNative ? input.lapses : 0,
        state:
            isFsrsNative && input.state !== null
                ? (input.state as State)
                : inferFsrsState(input),
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
        state: card.state,
        lapses: card.lapses,
        learningSteps: card.learning_steps,
    };
}

export function calculateNextReview(
    quality: AnswerQuality,
    input: WordProgressSchedulerInput,
    now: Date,
): SpacedRepetitionResult {
    const card = wordProgressToFsrsCard(input, now);
    const rating = answerQualityToFsrsRating(quality);
    const { card: nextCard } = wordslyFsrs.next(card, now, rating);
    return fsrsCardToProgress(nextCard, now);
}
