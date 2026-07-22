/**
 * Pure functions for daily pacing: how many new words / reviews a user may still
 * be served today given their configured limits and what they've already done.
 * No I/O — the service supplies today's counts and the settings.
 */

export interface PacingLimits {
    dailyNewWordLimit: number;
    dailyReviewLimit: number;
}

export interface TodayCounts {
    /** Total answers recorded today (new + review). */
    reviews: number;
    /** New words first seen today. */
    newWords: number;
}

export interface PacingBudget {
    newWordsRemainingToday: number;
    reviewsRemainingToday: number;
    dailyNewWordLimit: number;
    dailyReviewLimit: number;
}

/** Remaining daily budget, clamped at zero (a limit of 0 disables that stream). */
export function computePacingBudget(
    limits: PacingLimits,
    today: TodayCounts,
): PacingBudget {
    return {
        newWordsRemainingToday: Math.max(
            0,
            limits.dailyNewWordLimit - today.newWords,
        ),
        reviewsRemainingToday: Math.max(
            0,
            limits.dailyReviewLimit - today.reviews,
        ),
        dailyNewWordLimit: limits.dailyNewWordLimit,
        dailyReviewLimit: limits.dailyReviewLimit,
    };
}

/** How many due reviews to fetch: the requested count capped by remaining budget. */
export function reviewTake(
    requestedLimit: number,
    budget: PacingBudget,
): number {
    return Math.max(0, Math.min(requestedLimit, budget.reviewsRemainingToday));
}

/**
 * How many new words to fetch.
 *
 * When `newLimit` is provided, new words get their own cap independent of how
 * many due reviews were chosen (the "separate words-per-session for new words"
 * setting). When omitted, new words fill whatever room the combined
 * `requestedLimit` leaves after due words — the legacy behaviour.
 *
 * In both cases the daily new-word budget is the hard ceiling.
 */
export function newWordTake(
    requestedLimit: number,
    dueCount: number,
    budget: PacingBudget,
    newLimit?: number,
): number {
    const room =
        newLimit === undefined ? requestedLimit - dueCount : newLimit;
    return Math.max(0, Math.min(room, budget.newWordsRemainingToday));
}
