/**
 * Pure rules for an *off-schedule* review: one the learner asked for by picking
 * the word themselves (a saved/difficult-word session) rather than being handed
 * it by the scheduler. No I/O — the service supplies the stored card state.
 *
 * Why this exists: FSRS infers memory stability from how long the learner went
 * without seeing the card (`elapsed_days`, measured from `lastReviewedAt`). An
 * answer given deliberately *early* carries almost no information about
 * retention — of course you remember a word you looked at yesterday — yet
 * feeding it to `fsrs.next()` still updates stability and pushes `nextReviewAt`
 * further out. The word the learner flagged as hard would then disappear for
 * longer than before they flagged it, which is the exact opposite of what they
 * asked for. Anki solves the same problem by letting a filtered deck answer
 * cards without rescheduling them.
 *
 * The rule here is deliberately asymmetric — an off-schedule answer may only
 * ever pull a card *closer*, never push it away:
 *
 * - correct + not yet due  → the schedule is left completely alone
 * - wrong + not yet due    → normal FSRS applies (the card lapses and comes back
 *                            soon), because failing a word early is genuine
 *                            evidence that it was forgotten
 * - anything on a due or new card → normal FSRS, this is an ordinary review
 *
 * So the schedule cannot be farmed for longer intervals, and a genuinely
 * forgotten word cannot be hidden.
 */

import { FSRS_STATE_REVIEW } from './leech.logic';

export interface OffScheduleCardState {
    /** Persisted FSRS State enum value; null on legacy rows. */
    state: number | null;
    nextReviewAt: Date;
    totalReviews: number;
}

/**
 * Whether this answer is an early, learner-initiated review of a settled card.
 *
 * Only cards in the **Review** state are protected. A card still walking its
 * learning or relearning steps is *meant* to be answered again minutes later —
 * that intraday repetition is how the step schedule works, and how a practice
 * session's repeated exposures of a new word advance it — so those answers go
 * through FSRS as they always have. There is also no long interval to protect
 * on such a card, which is the only thing this rule exists to defend.
 */
export function isOffScheduleReview(
    existing: OffScheduleCardState | null,
    reviewedAt: Date,
): boolean {
    if (!existing || existing.totalReviews === 0) {
        return false;
    }
    if (existing.state !== FSRS_STATE_REVIEW) {
        return false;
    }
    return existing.nextReviewAt > reviewedAt;
}

/**
 * Whether the card's schedule must be carried over untouched instead of taking
 * the freshly computed FSRS result.
 */
export function shouldPreserveSchedule(
    existing: OffScheduleCardState | null,
    reviewedAt: Date,
    isCorrect: boolean,
): boolean {
    return isCorrect && isOffScheduleReview(existing, reviewedAt);
}

/** The full card state an off-schedule answer leaves exactly as it found it. */
export interface PreservedSchedule {
    easeFactor: number;
    interval: number;
    repetitions: number;
    stability: number;
    nextReviewAt: Date;
    state: number;
    lapses: number;
    learningSteps: number;
    correctStreak: number;
    /**
     * Deliberately carried over too. Advancing it would shrink the
     * `elapsed_days` the *next* real review is scored against, which is the
     * back door into exactly the stability corruption this module prevents:
     * the schedule would survive the cram, but the card's memory model would
     * not.
     */
    lastReviewedAt: Date | null;
    isLeech: boolean;
    lapsesAtRescue: number;
    rescuedCount: number;
}

/** Lift the stored row's schedule back out, unchanged. */
export function preserveSchedule(
    existing: PreservedSchedule,
): PreservedSchedule {
    return {
        easeFactor: existing.easeFactor,
        interval: existing.interval,
        repetitions: existing.repetitions,
        stability: existing.stability,
        nextReviewAt: existing.nextReviewAt,
        state: existing.state,
        lapses: existing.lapses,
        learningSteps: existing.learningSteps,
        correctStreak: existing.correctStreak,
        lastReviewedAt: existing.lastReviewedAt,
        isLeech: existing.isLeech,
        lapsesAtRescue: existing.lapsesAtRescue,
        rescuedCount: existing.rescuedCount,
    };
}
