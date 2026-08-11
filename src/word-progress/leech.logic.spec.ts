import {
    FSRS_STATE_REVIEW,
    isLeechAfterAnswer,
    isRescued,
    nextCorrectStreak,
    RESCUE_CORRECT_STREAK,
    resolveLeechState,
    type LeechStateInput,
} from './leech.logic';

const base: LeechStateInput = {
    wasLeech: false,
    lapsesAtRescue: 0,
    rescuedCount: 0,
    lapses: 0,
    state: FSRS_STATE_REVIEW,
    correctStreak: 0,
    threshold: 8,
};

describe('nextCorrectStreak', () => {
    it('increments on correct and resets to zero on wrong', () => {
        expect(nextCorrectStreak(2, true)).toBe(3);
        expect(nextCorrectStreak(7, false)).toBe(0);
    });
});

describe('isLeechAfterAnswer', () => {
    it('flags at the threshold for a card that has never been rescued', () => {
        expect(isLeechAfterAnswer({ lapses: 7, lapsesAtRescue: 0, threshold: 8 })).toBe(false);
        expect(isLeechAfterAnswer({ lapses: 8, lapsesAtRescue: 0, threshold: 8 })).toBe(true);
    });

    it('measures lapses since the last rescue, not lifetime', () => {
        // Rescued at 8 lifetime lapses: needs 8 more before it counts again.
        expect(isLeechAfterAnswer({ lapses: 15, lapsesAtRescue: 8, threshold: 8 })).toBe(false);
        expect(isLeechAfterAnswer({ lapses: 16, lapsesAtRescue: 8, threshold: 8 })).toBe(true);
    });

    it('never flags when the threshold is disabled', () => {
        expect(isLeechAfterAnswer({ lapses: 99, lapsesAtRescue: 0, threshold: 0 })).toBe(false);
    });
});

describe('isRescued', () => {
    it('requires a leech, the Review state, and the full correct streak', () => {
        const ready = {
            wasLeech: true,
            state: FSRS_STATE_REVIEW,
            correctStreak: RESCUE_CORRECT_STREAK,
        };
        expect(isRescued(ready)).toBe(true);
        expect(isRescued({ ...ready, wasLeech: false })).toBe(false);
        expect(isRescued({ ...ready, correctStreak: RESCUE_CORRECT_STREAK - 1 })).toBe(false);
        // Still climbing back through relearning steps — not rescued yet.
        expect(isRescued({ ...ready, state: 3 })).toBe(false);
    });
});

describe('resolveLeechState', () => {
    it('matches the legacy rule for a card that has never been rescued', () => {
        expect(resolveLeechState({ ...base, lapses: 8 })).toEqual({
            isLeech: true,
            lapsesAtRescue: 0,
            rescuedCount: 0,
            rescued: false,
        });
    });

    it('clears the flag on the answer that earns the rescue', () => {
        const result = resolveLeechState({
            ...base,
            wasLeech: true,
            lapses: 8,
            correctStreak: RESCUE_CORRECT_STREAK,
        });
        expect(result).toEqual({
            isLeech: false,
            lapsesAtRescue: 8,
            rescuedCount: 1,
            rescued: true,
        });
    });

    it('clears the flag even for a badly-lapsed card', () => {
        // Regression guard: a threshold-multiplier rule would leave a card with
        // 30 lapses flagged after its first rescue. Rebasing cannot.
        const result = resolveLeechState({
            ...base,
            wasLeech: true,
            lapses: 30,
            correctStreak: RESCUE_CORRECT_STREAK,
        });
        expect(result.isLeech).toBe(false);
        expect(result.lapsesAtRescue).toBe(30);
    });

    it('keeps a leech flagged while it is still failing', () => {
        const result = resolveLeechState({
            ...base,
            wasLeech: true,
            lapses: 9,
            state: 3,
            correctStreak: 0,
        });
        expect(result).toEqual({
            isLeech: true,
            lapsesAtRescue: 0,
            rescuedCount: 0,
            rescued: false,
        });
    });

    it('re-flags a rescued card only after another full threshold of lapses', () => {
        const rescued = { ...base, lapsesAtRescue: 8, rescuedCount: 1 };
        expect(resolveLeechState({ ...rescued, lapses: 15 }).isLeech).toBe(false);
        expect(resolveLeechState({ ...rescued, lapses: 16 }).isLeech).toBe(true);
    });

    it('does not rescue a card that was never a leech', () => {
        const result = resolveLeechState({
            ...base,
            lapses: 2,
            correctStreak: 10,
        });
        expect(result.rescued).toBe(false);
        expect(result.rescuedCount).toBe(0);
    });
});
