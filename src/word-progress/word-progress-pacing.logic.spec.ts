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

    it('does not bill a new word to the review budget as well', () => {
        // 12 answers today, 5 of them first sightings → 7 genuine reviews.
        const budget = computePacingBudget(
            { dailyNewWordLimit: 10, dailyReviewLimit: 20 },
            { reviews: 12, newWords: 5 },
        );
        expect(budget.reviewsRemainingToday).toBe(13);
        expect(budget.newWordsRemainingToday).toBe(5);
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

    it('treats newLimit as a ceiling inside the session, not an extra allowance', () => {
        const roomy = { ...budget, newWordsRemainingToday: 10 };
        // Room to spare: newLimit is what binds.
        expect(newWordTake(20, 0, roomy, 5)).toBe(5);
        // Session already full of due words: no new words on top of them.
        expect(newWordTake(20, 20, roomy, 5)).toBe(0);
        // Partially full: the session cap binds before newLimit does.
        expect(newWordTake(20, 18, roomy, 5)).toBe(2);
        // Daily new-word budget is still the hard ceiling.
        expect(newWordTake(20, 0, budget, 5)).toBe(3); // budget 3 < newLimit 5
        // newLimit of 0 disables new words even with room and budget.
        expect(newWordTake(20, 0, roomy, 0)).toBe(0);
    });
});
