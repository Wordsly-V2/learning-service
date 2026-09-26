import { addClientDays } from '@/daily-habit/daily-habit.logic';

/**
 * What an admin reset may clear. TEXT at the API boundary, checked with `@IsIn`:
 *
 * - `cards`: FSRS cards (all, or one `source`), so items come back as new.
 * - `streak`: the practice-day ledger and every streak counter; the daily goal
 *   setting is kept.
 * - `xp`: XP, level, achievements and the per-day XP grant ledger, so XP can
 *   be earned again from scratch.
 * - `all`: the three above plus the report history (`DailyReviewStat`) and the
 *   per-day practised-word ledger. Settings, preferences, saved words and
 *   notifications are never touched.
 */
export const RESET_SCOPES = ['cards', 'streak', 'xp', 'all'] as const;
export type ResetScope = (typeof RESET_SCOPES)[number];

export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 365;
/** Retention columns shown per cohort: week 0 (the cohort itself) to week 11. */
export const RETENTION_WEEKS = 12;
export const MAX_SUMMARY_IDS = 100;

export interface DateRange {
    /** Inclusive calendar day, `YYYY-MM-DD`. */
    from: string;
    /** Inclusive calendar day, `YYYY-MM-DD`. */
    to: string;
}

/**
 * Fill in a missing end (today) and start (`DEFAULT_RANGE_DAYS` back), and
 * refuse ranges that are backwards or longer than `MAX_RANGE_DAYS`. Returns the
 * refusal as a string so the caller picks the exception.
 */
export function resolveRange(
    from: string | undefined,
    to: string | undefined,
    today: string = new Date().toISOString().slice(0, 10),
): DateRange | string {
    const end = to ?? today;
    const start = from ?? addClientDays(end, -(DEFAULT_RANGE_DAYS - 1));
    const span = daysBetween(start, end) + 1;
    if (span < 1) return '`from` must not be after `to`';
    if (span > MAX_RANGE_DAYS) {
        return `The range may span at most ${MAX_RANGE_DAYS} days`;
    }
    return { from: start, to: end };
}

/** Every day of the range, in order. */
export function eachDay(range: DateRange): string[] {
    const days: string[] = [];
    for (let day = range.from; day <= range.to; day = addClientDays(day, 1)) {
        days.push(day);
    }
    return days;
}

export interface DailyActivity {
    date: string;
    /** Learners who practised or answered at least once that day. */
    activeLearners: number;
    reviews: number;
    correctReviews: number;
    newWords: number;
}

/** One point per day of the range, zero where nothing happened. */
export function fillDailyActivity(
    range: DateRange,
    active: readonly { date: string; learners: number }[],
    reviews: readonly {
        date: string;
        reviews: number;
        correctReviews: number;
        newWords: number;
    }[],
): DailyActivity[] {
    const activeBy = new Map(active.map((row) => [row.date, row.learners]));
    const reviewsBy = new Map(reviews.map((row) => [row.date, row]));
    return eachDay(range).map((date) => {
        const day = reviewsBy.get(date);
        return {
            date,
            activeLearners: activeBy.get(date) ?? 0,
            reviews: day?.reviews ?? 0,
            correctReviews: day?.correctReviews ?? 0,
            newWords: day?.newWords ?? 0,
        };
    });
}

/**
 * Whether a stored streak is still alive. `DailyHabit.streak` is recomputed on
 * practice, not on a timer, so a learner who stopped keeps their old number.
 * Dates are the learner's own calendar, which can sit a day either side of the
 * server's, hence the two-day allowance: this is for a dashboard, and a streak
 * that is at most a day past its end is not worth a timezone lookup.
 */
export function isStreakAlive(
    lastPracticeDate: string | null,
    today: string,
): boolean {
    return !!lastPracticeDate && lastPracticeDate >= addClientDays(today, -2);
}

export const STREAK_BUCKETS = [
    { label: '0', min: 0, max: 0 },
    { label: '1–2', min: 1, max: 2 },
    { label: '3–6', min: 3, max: 6 },
    { label: '7–13', min: 7, max: 13 },
    { label: '14–29', min: 14, max: 29 },
    { label: '30+', min: 30, max: Infinity },
] as const;

/** How many learners hold a live streak of each length. */
export function bucketStreaks(
    streaks: readonly number[],
): { label: string; learners: number }[] {
    return STREAK_BUCKETS.map((bucket) => ({
        label: bucket.label,
        learners: streaks.filter((s) => s >= bucket.min && s <= bucket.max)
            .length,
    }));
}

export interface RetentionCohort {
    /** Monday of the week these learners were first active. */
    cohort: string;
    size: number;
    /**
     * Share of the cohort active in week 0, 1, 2… after it started (week 0 is
     * always 1). Stops at the current week, so a young cohort has fewer points.
     */
    weeks: number[];
}

/**
 * Shape `(cohort week, weeks since, learners)` rows into a retention table.
 * Week 0's count is the cohort size; weeks after `lastWeek` are not reported.
 */
export function shapeRetention(
    rows: readonly { cohort: string; week: number; learners: number }[],
    lastWeek: string,
): RetentionCohort[] {
    const byCohort = new Map<string, Map<number, number>>();
    for (const row of rows) {
        if (row.week < 0 || row.week >= RETENTION_WEEKS) continue;
        const weeks = byCohort.get(row.cohort) ?? new Map<number, number>();
        weeks.set(row.week, row.learners);
        byCohort.set(row.cohort, weeks);
    }

    return [...byCohort.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cohort, weeks]) => {
            const size = weeks.get(0) ?? 0;
            const elapsed = Math.min(
                RETENTION_WEEKS,
                Math.floor(daysBetween(cohort, lastWeek) / 7) + 1,
            );
            return {
                cohort,
                size,
                weeks: Array.from({ length: elapsed }, (_, week) =>
                    size === 0 ? 0 : round((weeks.get(week) ?? 0) / size),
                ),
            };
        })
        .filter((cohort) => cohort.size > 0);
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    return addClientDays(date, -((weekday + 6) % 7));
}

function daysBetween(from: string, to: string): number {
    return Math.round(
        (Date.parse(`${to}T00:00:00.000Z`) -
            Date.parse(`${from}T00:00:00.000Z`)) /
            86_400_000,
    );
}

function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}
