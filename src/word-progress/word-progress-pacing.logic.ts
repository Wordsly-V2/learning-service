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
    /** New words first seen today — a subset of `reviews`, not a separate tally. */
    newWords: number;
    /**
     * Wordsly Path items first seen today — a subset of `newWords`. A Path
     * lesson paces its own introductions, so they are exempt from the daily
     * new-word limit (which governs the learner's own vocabulary). Their later
     * reviews share the review limit like any other card.
     */
    pathNewWords?: number;
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
    // `reviews` counts every answer recorded today, a first sighting of a new
    // word included, so the genuine review count is `reviews - newWords`.
    // Subtracting it matters: the two limits are meant to be independent
    // budgets, and billing a new word to both meant that taking on today's new
    // words silently shrank today's review session by the same number.
    const reviewsUsed = Math.max(0, today.reviews - today.newWords);
    const vocabNewWords = Math.max(
        0,
        today.newWords - (today.pathNewWords ?? 0),
    );

    return {
        newWordsRemainingToday: Math.max(
            0,
            limits.dailyNewWordLimit - vocabNewWords,
        ),
        reviewsRemainingToday: Math.max(
            0,
            limits.dailyReviewLimit - reviewsUsed,
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
 * `requestedLimit` is the size of the whole session, so new words only ever fill
 * the room due words left behind. `newLimit` narrows that room further — it is a
 * ceiling on new words, not a second allowance added on top. It used to be the
 * latter, which is why a learner who asked for twenty words a session could be
 * handed twenty reviews plus five new ones and wonder where the extra five came
 * from.
 *
 * The daily new-word budget is the hard ceiling over both.
 */
export function newWordTake(
    requestedLimit: number,
    dueCount: number,
    budget: PacingBudget,
    newLimit?: number,
): number {
    const roomLeftInSession = requestedLimit - dueCount;
    const room =
        newLimit === undefined
            ? roomLeftInSession
            : Math.min(newLimit, roomLeftInSession);
    return Math.max(0, Math.min(room, budget.newWordsRemainingToday));
}
