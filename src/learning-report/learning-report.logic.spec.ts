import {
    accuracyPercent,
    bucketKeyForDate,
    buildReportRange,
    computeAchievements,
    computePathAchievements,
    reviewedWordCount,
} from './learning-report.logic';

describe('buildReportRange', () => {
    it('builds 7 daily buckets for the week period ending on clientDate', () => {
        const range = buildReportRange('week', '2026-06-23');
        expect(range.granularity).toBe('day');
        expect(range.buckets).toHaveLength(7);
        expect(range.start).toBe('2026-06-17');
        expect(range.end).toBe('2026-06-23');
        expect(range.buckets[0].key).toBe('2026-06-17');
        expect(range.buckets[6].key).toBe('2026-06-23');
    });

    it('builds 30 daily buckets for the month period', () => {
        const range = buildReportRange('month', '2026-06-23');
        expect(range.granularity).toBe('day');
        expect(range.buckets).toHaveLength(30);
        expect(range.start).toBe('2026-05-25');
        expect(range.buckets.at(-1)?.key).toBe('2026-06-23');
    });

    it('steps a whole week back for offset 1', () => {
        const range = buildReportRange('week', '2026-06-23', 1);
        expect(range.offset).toBe(1);
        expect(range.start).toBe('2026-06-10');
        expect(range.end).toBe('2026-06-16');
        expect(range.buckets).toHaveLength(7);
    });

    it('tiles consecutive week windows without gaps or overlap', () => {
        const current = buildReportRange('week', '2026-06-23');
        const previous = buildReportRange('week', '2026-06-23', 1);
        expect(previous.end).toBe('2026-06-16');
        expect(current.start).toBe('2026-06-17');
    });

    it('steps a whole 30-day window back for offset 2', () => {
        const range = buildReportRange('month', '2026-06-23', 2);
        expect(range.end).toBe('2026-04-24');
        expect(range.start).toBe('2026-03-26');
        expect(range.buckets).toHaveLength(30);
    });

    it('ends a past year window on its last calendar day', () => {
        const range = buildReportRange('year', '2026-06-23', 1);
        expect(range.buckets[0].key).toBe('2024-07');
        expect(range.buckets.at(-1)?.key).toBe('2025-06');
        expect(range.start).toBe('2024-07-01');
        expect(range.end).toBe('2025-06-30');
    });

    it('treats a negative or fractional offset as the current window', () => {
        expect(buildReportRange('week', '2026-06-23', -3).end).toBe(
            '2026-06-23',
        );
        expect(buildReportRange('week', '2026-06-23', 1.9).end).toBe(
            '2026-06-16',
        );
    });

    it('builds 12 monthly buckets for the year period', () => {
        const range = buildReportRange('year', '2026-06-23');
        expect(range.granularity).toBe('month');
        expect(range.buckets).toHaveLength(12);
        expect(range.buckets[0].key).toBe('2025-07');
        expect(range.buckets[0].start).toBe('2025-07-01');
        expect(range.buckets.at(-1)?.key).toBe('2026-06');
        expect(range.buckets.at(-1)?.start).toBe('2026-06-01');
    });
});

describe('bucketKeyForDate', () => {
    it('returns the full date for daily granularity', () => {
        expect(bucketKeyForDate('2026-06-23', 'day')).toBe('2026-06-23');
    });

    it('returns the month prefix for monthly granularity', () => {
        expect(bucketKeyForDate('2026-06-23', 'month')).toBe('2026-06');
    });
});

describe('accuracyPercent', () => {
    it('returns null when there are no reviews', () => {
        expect(accuracyPercent(0, 0)).toBeNull();
    });

    it('rounds to one decimal place', () => {
        expect(accuracyPercent(5, 6)).toBe(83.3);
        expect(accuracyPercent(3, 4)).toBe(75);
    });
});

describe('reviewedWordCount', () => {
    it('subtracts new words from the words practiced', () => {
        expect(reviewedWordCount(12, 5)).toBe(7);
    });

    it('clamps at zero when the aggregates disagree', () => {
        expect(reviewedWordCount(3, 5)).toBe(0);
    });
});

describe('computeAchievements', () => {
    it('marks milestones at or below the lifetime values as achieved', () => {
        const badges = computeAchievements({
            longestStreak: 8,
            totalWordsPracticed: 120,
            totalPracticeDays: 10,
        });
        const streak7 = badges.find((b) => b.key === 'streak-7');
        const streak14 = badges.find((b) => b.key === 'streak-14');
        const words100 = badges.find((b) => b.key === 'words-100');
        expect(streak7?.achieved).toBe(true);
        expect(streak14?.achieved).toBe(false);
        expect(words100?.achieved).toBe(true);
        expect(words100?.value).toBe(120);
    });
});

describe('computePathAchievements', () => {
    it('lists every Path milestone with progress toward it', () => {
        const badges = computePathAchievements({
            lessonsCompleted: 12,
            unitsCompleted: 4,
            stagesCompleted: 1,
        });
        expect(badges.filter((b) => b.achieved).map((b) => b.key)).toEqual([
            'lessons-1',
            'lessons-10',
            'units-1',
            'stages-1',
        ]);
        expect(badges.find((b) => b.key === 'units-5')).toMatchObject({
            category: 'units',
            achieved: false,
            value: 4,
            target: 5,
        });
        expect(badges.find((b) => b.key === 'lessons-1')?.label).toBe(
            'First Path lesson completed',
        );
        expect(badges.find((b) => b.key === 'stages-2')?.label).toBe(
            '2 Path stages completed',
        );
    });
});
