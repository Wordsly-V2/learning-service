/**
 * Pure leech rules: when a card is flagged as a leech, and when a learner has
 * earned it back. No I/O — the service supplies the post-answer card state.
 *
 * Why this exists: `isLeech` used to be recomputed on every answer as
 * `lapses >= threshold`. FSRS `lapses` only ever increments, so once a card
 * crossed the threshold the flag could never clear — a word the learner had
 * since mastered stayed on the "Difficult words" list forever.
 *
 * The fix is to measure lapses *since the last rescue* rather than lifetime
 * lapses. `lapsesAtRescue` starts at 0, so for a card that has never been
 * rescued the rule is byte-identical to the old one.
 */

/** FSRS State enum value for a card in the Review state. */
export const FSRS_STATE_REVIEW = 2;

/**
 * Consecutive correct answers required to rescue a leech.
 *
 * Note this is NOT `WordProgress.repetitions`: that column stores ts-fsrs
 * `card.reps`, which increments on every review including failures. A true
 * consecutive-correct streak has to be tracked separately (`correctStreak`).
 */
export const RESCUE_CORRECT_STREAK = 3;

export interface LeechStateInput {
    /** Whether the card was already flagged before this answer. */
    wasLeech: boolean;
    /** Lifetime lapse count as of the last rescue (0 if never rescued). */
    lapsesAtRescue: number;
    /** How many times this card has been rescued before. */
    rescuedCount: number;
    /** Post-answer lifetime lapses, from FSRS. */
    lapses: number;
    /** Post-answer FSRS state. */
    state: number;
    /** Post-answer consecutive-correct streak. */
    correctStreak: number;
    /** User's configured leech threshold. */
    threshold: number;
}

export interface LeechState {
    isLeech: boolean;
    lapsesAtRescue: number;
    rescuedCount: number;
    /** True only on the answer that crossed the rescue bar. */
    rescued: boolean;
}

/** Consecutive-correct streak after an answer; any wrong answer resets it. */
export function nextCorrectStreak(previous: number, isCorrect: boolean): number {
    return isCorrect ? previous + 1 : 0;
}

/**
 * A card is a leech once it has lapsed `threshold` times since its last rescue.
 * A threshold of 0 or less disables leech flagging entirely.
 */
export function isLeechAfterAnswer(
    input: Pick<LeechStateInput, 'lapses' | 'lapsesAtRescue' | 'threshold'>,
): boolean {
    if (input.threshold <= 0) {
        return false;
    }
    return input.lapses - input.lapsesAtRescue >= input.threshold;
}

/**
 * A leech is rescued when it climbs back to the Review state on a streak of
 * consecutive correct answers. Requiring Review state (not just the streak)
 * means intraday learning steps can't rescue a card on their own.
 */
export function isRescued(
    input: Pick<LeechStateInput, 'wasLeech' | 'state' | 'correctStreak'>,
): boolean {
    return (
        input.wasLeech &&
        input.state === FSRS_STATE_REVIEW &&
        input.correctStreak >= RESCUE_CORRECT_STREAK
    );
}

/**
 * Resolve the full leech state after an answer. Rescue is applied first so the
 * flag is recomputed against the new baseline — that is what lets a rescued
 * card leave the list on the same answer that earned it.
 */
export function resolveLeechState(input: LeechStateInput): LeechState {
    const rescued = isRescued(input);
    const lapsesAtRescue = rescued ? input.lapses : input.lapsesAtRescue;
    const rescuedCount = input.rescuedCount + (rescued ? 1 : 0);

    return {
        isLeech: isLeechAfterAnswer({
            lapses: input.lapses,
            lapsesAtRescue,
            threshold: input.threshold,
        }),
        lapsesAtRescue,
        rescuedCount,
        rescued,
    };
}
