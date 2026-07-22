import {
    computePacingBudget,
    newWordTake,
    reviewTake,
} from './word-progress-pacing.logic';

describe('computePacingBudget', () => {
    it('subtracts today’s counts and clamps at zero', () => {
        const budget = computePacingBudget(
            { dailyNewWordLimit: 10, dailyReviewLimit: 100 },
            { reviews: 105, newWords: 4 },
        );
        expect(budget.newWordsRemainingToday).toBe(6);
        expect(budget.reviewsRemainingToday).toBe(0);
    });
});

describe('reviewTake / newWordTake', () => {
    const budget = {
        newWordsRemainingToday: 3,
        reviewsRemainingToday: 8,
        dailyNewWordLimit: 10,
        dailyReviewLimit: 100,
    };

    it('caps reviews by the smaller of request and budget', () => {
        expect(reviewTake(20, budget)).toBe(8);
        expect(reviewTake(5, budget)).toBe(5);
    });

    it('fills remaining request room with new words within budget', () => {
        expect(newWordTake(20, 8, budget)).toBe(3); // room 12, budget 3
        expect(newWordTake(9, 8, budget)).toBe(1); // room 1
        expect(newWordTake(8, 8, budget)).toBe(0); // no room
    });

    it('uses an explicit newLimit independent of due count, still budget-capped', () => {
        const roomy = { ...budget, newWordsRemainingToday: 10 };
        // newLimit wins over `limit - dueCount`: 5 new words regardless of dues.
        expect(newWordTake(20, 18, roomy, 5)).toBe(5);
        expect(newWordTake(20, 0, roomy, 5)).toBe(5);
        // Daily new-word budget is still the hard ceiling.
        expect(newWordTake(20, 0, budget, 5)).toBe(3); // budget 3 < newLimit 5
        // newLimit of 0 disables new words even with room and budget.
        expect(newWordTake(20, 0, roomy, 0)).toBe(0);
    });
});
