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
});
