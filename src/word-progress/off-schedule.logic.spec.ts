import {
    isOffScheduleReview,
    preserveSchedule,
    shouldPreserveSchedule,
    type PreservedSchedule,
} from './off-schedule.logic';
import { FSRS_STATE_REVIEW } from './leech.logic';

const NOW = new Date('2026-09-17T10:00:00.000Z');
const IN_TEN_DAYS = new Date('2026-09-27T10:00:00.000Z');
const YESTERDAY = new Date('2026-09-16T10:00:00.000Z');

const State = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const;

function card(
    overrides: Partial<PreservedSchedule> & { state?: number } = {},
): PreservedSchedule {
    return {
        easeFactor: 5.1,
        interval: 10,
        repetitions: 6,
        stability: 12.4,
        nextReviewAt: IN_TEN_DAYS,
        state: FSRS_STATE_REVIEW,
        lapses: 2,
        learningSteps: 0,
        correctStreak: 3,
        lastReviewedAt: YESTERDAY,
        isLeech: false,
        lapsesAtRescue: 0,
        rescuedCount: 0,
        ...overrides,
    };
}

function withReviews(c: PreservedSchedule, totalReviews = 6) {
    return { ...c, totalReviews };
}

describe('isOffScheduleReview', () => {
    it('is true for a Review card answered before its due date', () => {
        expect(isOffScheduleReview(withReviews(card()), NOW)).toBe(true);
    });

    it('is false once the card is due', () => {
        expect(
            isOffScheduleReview(
                withReviews(card({ nextReviewAt: YESTERDAY })),
                NOW,
            ),
        ).toBe(false);
    });

    it('is false for a card that has never been answered', () => {
        expect(isOffScheduleReview(null, NOW)).toBe(false);
        expect(isOffScheduleReview(withReviews(card(), 0), NOW)).toBe(false);
    });

    it.each([
        ['Learning', State.Learning],
        ['Relearning', State.Relearning],
        ['New', State.New],
    ])(
        'is false for a %s card — intraday steps are meant to repeat',
        (_label, state) => {
            expect(isOffScheduleReview(withReviews(card({ state })), NOW)).toBe(
                false,
            );
        },
    );

    it('is false on a legacy row with no persisted state', () => {
        expect(
            isOffScheduleReview(
                { state: null, nextReviewAt: IN_TEN_DAYS, totalReviews: 6 },
                NOW,
            ),
        ).toBe(false);
    });
});

describe('shouldPreserveSchedule', () => {
    it('preserves a correct answer given early', () => {
        expect(shouldPreserveSchedule(withReviews(card()), NOW, true)).toBe(
            true,
        );
    });

    it('does NOT preserve a wrong answer given early — forgetting is real evidence', () => {
        expect(shouldPreserveSchedule(withReviews(card()), NOW, false)).toBe(
            false,
        );
    });

    it('does not preserve an ordinary due review', () => {
        const due = withReviews(card({ nextReviewAt: YESTERDAY }));
        expect(shouldPreserveSchedule(due, NOW, true)).toBe(false);
        expect(shouldPreserveSchedule(due, NOW, false)).toBe(false);
    });
});

describe('preserveSchedule', () => {
    it('carries every scheduling field over untouched', () => {
        const stored = card();
        expect(preserveSchedule(stored)).toEqual(stored);
    });

    it('keeps lastReviewedAt, so the next real review is scored against the full gap', () => {
        expect(preserveSchedule(card()).lastReviewedAt).toEqual(YESTERDAY);
    });

    it('keeps correctStreak, so a leech cannot be rescued by cramming', () => {
        expect(preserveSchedule(card({ correctStreak: 2 })).correctStreak).toBe(
            2,
        );
    });
});
