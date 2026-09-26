import {
    bucketStreaks,
    fillDailyActivity,
    isStreakAlive,
    MAX_RANGE_DAYS,
    resolveRange,
    shapeRetention,
    weekStart,
} from './admin-learning.logic';

describe('admin learning logic', () => {
    describe('resolveRange', () => {
        it('defaults to the 30 days ending today', () => {
            expect(resolveRange(undefined, undefined, '2026-09-26')).toEqual({
                from: '2026-08-28',
                to: '2026-09-26',
            });
        });

        it('refuses backwards and over-long ranges', () => {
            expect(resolveRange('2026-02-01', '2026-01-01')).toMatch(/after/);
            expect(resolveRange('2025-01-01', '2026-01-01')).toMatch(
                new RegExp(String(MAX_RANGE_DAYS)),
            );
        });
    });

    describe('fillDailyActivity', () => {
        it('has one point per day and zeros for quiet days', () => {
            expect(
                fillDailyActivity(
                    { from: '2026-09-01', to: '2026-09-02' },
                    [{ date: '2026-09-02', learners: 3 }],
                    [
                        {
                            date: '2026-09-02',
                            reviews: 40,
                            correctReviews: 30,
                            newWords: 5,
                        },
                    ],
                ),
            ).toEqual([
                {
                    date: '2026-09-01',
                    activeLearners: 0,
                    reviews: 0,
                    correctReviews: 0,
                    newWords: 0,
                },
                {
                    date: '2026-09-02',
                    activeLearners: 3,
                    reviews: 40,
                    correctReviews: 30,
                    newWords: 5,
                },
            ]);
        });
    });

    describe('isStreakAlive', () => {
        it('allows a day of timezone slack either side', () => {
            expect(isStreakAlive('2026-09-26', '2026-09-26')).toBe(true);
            expect(isStreakAlive('2026-09-27', '2026-09-26')).toBe(true);
            expect(isStreakAlive('2026-09-24', '2026-09-26')).toBe(true);
        });

        it('treats an older last practice, or none, as a broken streak', () => {
            expect(isStreakAlive('2026-09-23', '2026-09-26')).toBe(false);
            expect(isStreakAlive(null, '2026-09-26')).toBe(false);
        });
    });

    describe('bucketStreaks', () => {
        it('counts every learner in exactly one bucket', () => {
            const buckets = bucketStreaks([0, 0, 1, 5, 7, 29, 30, 400]);
            expect(buckets.map((b) => b.learners)).toEqual([2, 1, 1, 1, 1, 2]);
        });
    });

    describe('weekStart', () => {
        it('returns the Monday of the week', () => {
            expect(weekStart('2026-09-26')).toBe('2026-09-21'); // Saturday
            expect(weekStart('2026-09-21')).toBe('2026-09-21'); // Monday
            expect(weekStart('2026-09-27')).toBe('2026-09-21'); // Sunday
        });
    });

    describe('shapeRetention', () => {
        it('divides each week by the cohort size and stops at the last week', () => {
            expect(
                shapeRetention(
                    [
                        { cohort: '2026-09-07', week: 0, learners: 4 },
                        { cohort: '2026-09-07', week: 1, learners: 2 },
                        { cohort: '2026-09-07', week: 2, learners: 1 },
                        { cohort: '2026-09-21', week: 0, learners: 3 },
                    ],
                    '2026-09-21',
                ),
            ).toEqual([
                { cohort: '2026-09-07', size: 4, weeks: [1, 0.5, 0.25] },
                { cohort: '2026-09-21', size: 3, weeks: [1] },
            ]);
        });

        it('reports zero for a week nobody came back', () => {
            expect(
                shapeRetention(
                    [
                        { cohort: '2026-09-07', week: 0, learners: 2 },
                        { cohort: '2026-09-07', week: 2, learners: 1 },
                    ],
                    '2026-09-21',
                )[0].weeks,
            ).toEqual([1, 0, 0.5]);
        });
    });
});
