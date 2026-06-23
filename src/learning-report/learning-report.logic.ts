import {
    formatClientDate,
    parseClientDate,
} from '@/daily-habit/daily-habit-date.util';
import {
    addClientDays,
    STREAK_MILESTONES,
} from '@/daily-habit/daily-habit.logic';

export type ReportPeriod = 'week' | 'month' | 'year';
export type ReportGranularity = 'day' | 'month';

/** Days covered by the daily-bucket periods. */
export const WEEK_DAYS = 7;
export const MONTH_DAYS = 30;
/** Months covered by the yearly period. */
export const YEAR_MONTHS = 12;

/** A Review-state card with at least this interval (days) counts as "mastered". */
export const MASTERED_INTERVAL_DAYS = 21;

export interface BucketDef {
    /** Stable identifier: 'YYYY-MM-DD' for daily, 'YYYY-MM' for monthly. */
    key: string;
    /** First calendar date of the bucket (YYYY-MM-DD). */
    start: string;
}

export interface ReportRange {
    period: ReportPeriod;
    granularity: ReportGranularity;
    start: string;
    end: string;
    buckets: BucketDef[];
}

function startOfMonthUTC(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonthsUTC(d: Date, n: number): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

/** 'YYYY-MM' month key for a calendar date string. */
export function monthKey(date: string): string {
    return date.slice(0, 7);
}

/**
 * Build the time buckets for a report period, anchored at the client's "today".
 * - week  → last 7 days, one bucket per day
 * - month → last 30 days, one bucket per day
 * - year  → last 12 calendar months, one bucket per month
 * Buckets are pre-seeded so empty days/months render as zeros (no gaps).
 */
export function buildReportRange(
    period: ReportPeriod,
    clientDate: string,
): ReportRange {
    if (period === 'year') {
        const endMonth = startOfMonthUTC(parseClientDate(clientDate));
        const buckets: BucketDef[] = [];
        for (let i = YEAR_MONTHS - 1; i >= 0; i--) {
            const monthStart = addMonthsUTC(endMonth, -i);
            const start = formatClientDate(monthStart);
            buckets.push({ key: monthKey(start), start });
        }
        return {
            period,
            granularity: 'month',
            start: buckets[0].start,
            end: clientDate,
            buckets,
        };
    }

    const days = period === 'week' ? WEEK_DAYS : MONTH_DAYS;
    const start = addClientDays(clientDate, -(days - 1));
    const buckets: BucketDef[] = Array.from({ length: days }, (_, i) => {
        const date = addClientDays(start, i);
        return { key: date, start: date };
    });
    return {
        period,
        granularity: 'day',
        start,
        end: clientDate,
        buckets,
    };
}

/** Map a calendar date to its bucket key for the given granularity. */
export function bucketKeyForDate(
    date: string,
    granularity: ReportGranularity,
): string {
    return granularity === 'month' ? monthKey(date) : date;
}

/** Round an accuracy ratio to one decimal percent, or null when no reviews. */
export function accuracyPercent(
    correct: number,
    total: number,
): number | null {
    if (total <= 0) {
        return null;
    }
    return Math.round((correct / total) * 100 * 10) / 10;
}

export interface AchievementInput {
    longestStreak: number;
    totalWordsPracticed: number;
    totalPracticeDays: number;
}

export interface Achievement {
    key: string;
    label: string;
    category: 'streak' | 'words' | 'days';
    achieved: boolean;
    value: number;
    target: number;
}

/** Total words-practiced milestones worth celebrating. */
export const WORDS_MILESTONES = [50, 100, 250, 500, 1000, 2500] as const;
/** Total active-days milestones. */
export const PRACTICE_DAYS_MILESTONES = [7, 30, 100, 200, 365] as const;

/**
 * Derive achievement badges from lifetime totals. Returns every milestone
 * (achieved or locked) so the UI can show progress toward the next one.
 */
export function computeAchievements(input: AchievementInput): Achievement[] {
    const badges: Achievement[] = [];
    for (const target of STREAK_MILESTONES) {
        badges.push({
            key: `streak-${target}`,
            label: `${target}-day streak`,
            category: 'streak',
            achieved: input.longestStreak >= target,
            value: input.longestStreak,
            target,
        });
    }
    for (const target of WORDS_MILESTONES) {
        badges.push({
            key: `words-${target}`,
            label: `${target} words practiced`,
            category: 'words',
            achieved: input.totalWordsPracticed >= target,
            value: input.totalWordsPracticed,
            target,
        });
    }
    for (const target of PRACTICE_DAYS_MILESTONES) {
        badges.push({
            key: `days-${target}`,
            label: `${target} active days`,
            category: 'days',
            achieved: input.totalPracticeDays >= target,
            value: input.totalPracticeDays,
            target,
        });
    }
    return badges;
}
