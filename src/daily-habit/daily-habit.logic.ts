import {
    datesEqual,
    formatClientDate,
    parseClientDate,
    yesterdayClientDate,
} from './daily-habit-date.util';

/** Returns the next practice streak after today's session. */
export function nextPracticeStreak(
    currentStreak: number,
    lastPracticeDate: Date | null,
    today: Date,
    yesterday: Date,
): number {
    if (!lastPracticeDate) {
        return 1;
    }
    if (datesEqual(lastPracticeDate, today)) {
        return Math.max(currentStreak, 1);
    }
    if (datesEqual(lastPracticeDate, yesterday)) {
        return currentStreak + 1;
    }
    return 1;
}

export function isGoalMet(words: number, goal: number): boolean {
    return words >= goal;
}

/**
 * Practice streak shown to the user. A stored streak goes stale the moment a day
 * is missed, but the row isn't rewritten until the next session — so decay the
 * display value here, mirroring effectiveGoalStreak.
 */
export function effectivePracticeStreak(
    streak: number,
    lastPracticeDate: Date | null,
    clientDate: string,
): number {
    if (!lastPracticeDate || streak <= 0) {
        return 0;
    }
    const today = parseClientDate(clientDate);
    const yesterday = parseClientDate(yesterdayClientDate(clientDate));
    if (
        datesEqual(lastPracticeDate, today) ||
        datesEqual(lastPracticeDate, yesterday)
    ) {
        return streak;
    }
    return 0;
}

/**
 * A streak is "at risk" when the user practiced yesterday (keeping a live streak)
 * but hasn't practiced yet today — one more missed day breaks it.
 */
export function isStreakAtRisk(
    streak: number,
    lastPracticeDate: Date | null,
    clientDate: string,
): boolean {
    if (!lastPracticeDate || streak <= 0) {
        return false;
    }
    const today = parseClientDate(clientDate);
    const yesterday = parseClientDate(yesterdayClientDate(clientDate));
    return (
        !datesEqual(lastPracticeDate, today) &&
        datesEqual(lastPracticeDate, yesterday)
    );
}

/** Streak lengths worth celebrating / working toward. */
export const STREAK_MILESTONES = [7, 14, 30, 60, 100, 180, 365] as const;

/** Smallest milestone strictly greater than the current streak, or null past the top. */
export function nextStreakMilestone(streak: number): number | null {
    for (const milestone of STREAK_MILESTONES) {
        if (streak < milestone) {
            return milestone;
        }
    }
    return null;
}

/** True when today's session lands exactly on a milestone (for celebration). */
export function isStreakMilestone(streak: number): boolean {
    return (STREAK_MILESTONES as readonly number[]).includes(streak);
}

/**
 * Goal-streak lengths that each earn one streak freeze: the first after a
 * 3-day goal streak, the last after a 5-day goal streak.
 */
export const FREEZE_EARN_GOAL_STREAKS = [3, 5] as const;
/** Most freezes a user can bank at once. */
export const MAX_STREAK_FREEZES = 2;

/** Whole calendar days from a to b (both UTC-midnight @db.Date values). */
function dayDelta(a: Date, b: Date): number {
    return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Effective practice streak for display. Banked freezes bridge missed days
 * (one freeze per missed day) without mutating state — actual consumption
 * happens on the next recorded practice, so `freezesRemaining` reports the
 * balance the pending consumption will leave behind. With zero freezes this
 * reduces to effectivePracticeStreak: any missed day lapses the streak to 0.
 */
export function resolveDisplayStreak(params: {
    streak: number;
    lastPracticeDate: Date | null;
    freezes: number;
    clientDate: string;
}): { streak: number; shielded: boolean; freezesRemaining: number } {
    const { streak, lastPracticeDate, freezes, clientDate } = params;
    if (!lastPracticeDate || streak <= 0) {
        return { streak: 0, shielded: false, freezesRemaining: freezes };
    }
    const delta = dayDelta(lastPracticeDate, parseClientDate(clientDate));
    // delta 0 = practiced today, 1 = practiced yesterday — streak is live.
    if (delta <= 1) {
        return { streak, shielded: false, freezesRemaining: freezes };
    }
    const missed = delta - 1;
    if (missed > 0 && missed <= freezes) {
        // Each missed day is already spoken for by a banked freeze.
        return {
            streak,
            shielded: true,
            freezesRemaining: freezes - missed,
        };
    }
    // The gap outran the bank: every freeze was spent trying to cover it and
    // the streak still lapsed.
    return { streak: 0, shielded: false, freezesRemaining: 0 };
}

/**
 * Practice streak after today's session, letting freezes bridge a gap of
 * missed days. Returns how many freezes were consumed — the whole bank is
 * spent when the gap outruns it, even though the streak still lapses.
 */
export function nextPracticeStreakWithFreezes(params: {
    currentStreak: number;
    lastPracticeDate: Date | null;
    freezes: number;
    clientDate: string;
}): { streak: number; freezesConsumed: number } {
    const { currentStreak, lastPracticeDate, freezes, clientDate } = params;
    if (!lastPracticeDate) {
        return { streak: 1, freezesConsumed: 0 };
    }
    const delta = dayDelta(lastPracticeDate, parseClientDate(clientDate));
    if (delta <= 0) {
        return { streak: Math.max(currentStreak, 1), freezesConsumed: 0 };
    }
    if (delta === 1) {
        return { streak: currentStreak + 1, freezesConsumed: 0 };
    }
    const missed = delta - 1;
    if (missed <= freezes) {
        return { streak: currentStreak + 1, freezesConsumed: missed };
    }
    return { streak: 1, freezesConsumed: freezes };
}

/**
 * Freeze balance after a session: spend what was consumed against the gap (the
 * whole bank when the streak lapsed anyway), then award one for crossing a
 * goal-streak earn threshold, capped at MAX_STREAK_FREEZES.
 */
export function freezesAfterPractice(params: {
    currentFreezes: number;
    freezesConsumed: number;
    prevGoalStreak: number;
    newGoalStreak: number;
    goalMetToday: boolean;
}): number {
    const {
        currentFreezes,
        freezesConsumed,
        prevGoalStreak,
        newGoalStreak,
        goalMetToday,
    } = params;
    let freezes = Math.max(0, currentFreezes - freezesConsumed);
    if (goalMetToday && newGoalStreak > prevGoalStreak) {
        const earned = FREEZE_EARN_GOAL_STREAKS.filter(
            (threshold) =>
                threshold > prevGoalStreak && threshold <= newGoalStreak,
        ).length;
        freezes += earned;
    }
    return Math.min(freezes, MAX_STREAK_FREEZES);
}

/** Goal streak shown to the user; breaks when last goal met is older than yesterday. */
export function effectiveGoalStreak(
    goalStreak: number,
    lastGoalMetDate: Date | null,
    clientDate: string,
): number {
    if (!lastGoalMetDate || goalStreak <= 0) {
        return 0;
    }
    const today = parseClientDate(clientDate);
    const yesterday = parseClientDate(yesterdayClientDate(clientDate));
    if (
        datesEqual(lastGoalMetDate, today) ||
        datesEqual(lastGoalMetDate, yesterday)
    ) {
        return goalStreak;
    }
    return 0;
}

export function nextGoalStreak(
    currentGoalStreak: number,
    lastGoalMetDate: Date | null,
    today: Date,
    yesterday: Date,
    goalMetToday: boolean,
): { goalStreak: number; lastGoalMetDate: Date | null } {
    if (!goalMetToday) {
        return { goalStreak: currentGoalStreak, lastGoalMetDate };
    }
    if (!lastGoalMetDate) {
        return { goalStreak: 1, lastGoalMetDate: today };
    }
    if (datesEqual(lastGoalMetDate, today)) {
        return { goalStreak: currentGoalStreak, lastGoalMetDate };
    }
    if (datesEqual(lastGoalMetDate, yesterday)) {
        return { goalStreak: currentGoalStreak + 1, lastGoalMetDate: today };
    }
    return { goalStreak: 1, lastGoalMetDate: today };
}

export function addClientDays(date: string, delta: number): string {
    const parsed = parseClientDate(date);
    parsed.setUTCDate(parsed.getUTCDate() + delta);
    return formatClientDate(parsed);
}

export function lastNDays(endDate: string, count: number): string[] {
    return Array.from({ length: count }, (_, index) =>
        addClientDays(endDate, index - (count - 1)),
    );
}

export function habitMotivation(params: {
    goalMetToday: boolean;
    wordsToday: number;
    goal: number;
    streak: number;
    goalStreak: number;
    wordsRemaining: number;
    streakAtRisk?: boolean;
}): string {
    const {
        goalMetToday,
        wordsToday,
        goal,
        streak,
        goalStreak,
        wordsRemaining,
        streakAtRisk = false,
    } = params;

    if (goalMetToday && isStreakMilestone(streak)) {
        return `${streak}-day streak — a new milestone! 🎉`;
    }
    if (goalMetToday && goalStreak >= 7) {
        return `${goalStreak}-day goal streak — you're on fire!`;
    }
    if (goalMetToday) {
        return 'Daily goal complete. Keep the momentum going!';
    }
    // Live streak from yesterday but nothing done today — protect it first.
    if (streakAtRisk && wordsToday === 0) {
        return `Don't lose your ${streak}-day streak — practice today!`;
    }
    if (wordsToday > 0 && wordsRemaining <= 3) {
        return `Almost there — ${wordsRemaining} more word${wordsRemaining === 1 ? '' : 's'} to hit your goal.`;
    }
    // Closing in on a milestone: make the target tangible.
    const milestone = nextStreakMilestone(streak);
    if (streak >= 3 && milestone && milestone - streak <= 2 && wordsToday > 0) {
        const away = milestone - streak;
        return `${away} day${away === 1 ? '' : 's'} from a ${milestone}-day streak — keep going!`;
    }
    if (streak >= 3) {
        return `${streak}-day practice streak. ${wordsRemaining} words left today.`;
    }
    return `Practice ${goal} words a day to build your streak.`;
}

/** One day of practice history, as stored in DailyHabitDay. */
export interface HabitDayPoint {
    date: string;
    words: number;
    goalMet: boolean;
}

export interface RecomputedHabit {
    /** Contiguous run ending at today or yesterday; 0 if the streak is broken. */
    streak: number;
    /** Longest contiguous run anywhere in history. */
    longestStreak: number;
    goalStreak: number;
    longestGoalStreak: number;
    wordsToday: number;
    /** max(date) */
    lastPracticeDate: string | null;
    /** max(date where goalMet) */
    lastGoalMetDate: string | null;
}

/**
 * Derive every streak field from the full practice history instead of advancing a
 * single cursor.
 *
 * A cursor-based streak cannot express days arriving out of order: an offline
 * session from two days ago that fills a gap has to be able to JOIN two runs, and
 * `nextPracticeStreakWithFreezes` structurally cannot do that (a non-positive day
 * delta is absorbed and the gap stays). Walking the ledger can.
 *
 * Freeze-bridged streaks are deliberately not reconstructed here — which gaps a
 * freeze covered is path-dependent and unbounded. The caller floors the result
 * against the stored values, so a recompute can never take a streak away.
 *
 * @param days Ascending, distinct, YYYY-MM-DD.
 */
export function recomputeHabitFromDays(
    days: HabitDayPoint[],
    clientDate: string,
): RecomputedHabit {
    if (days.length === 0) {
        return {
            streak: 0,
            longestStreak: 0,
            goalStreak: 0,
            longestGoalStreak: 0,
            wordsToday: 0,
            lastPracticeDate: null,
            lastGoalMetDate: null,
        };
    }

    let runLength = 0;
    let longestStreak = 0;
    let goalRunLength = 0;
    let longestGoalStreak = 0;
    let previousDate: string | null = null;
    let previousGoalDate: string | null = null;
    let lastGoalMetDate: string | null = null;

    for (const day of days) {
        runLength =
            previousDate !== null && addClientDays(previousDate, 1) === day.date
                ? runLength + 1
                : 1;
        longestStreak = Math.max(longestStreak, runLength);
        previousDate = day.date;

        if (day.goalMet) {
            goalRunLength =
                previousGoalDate !== null &&
                addClientDays(previousGoalDate, 1) === day.date
                    ? goalRunLength + 1
                    : 1;
            longestGoalStreak = Math.max(longestGoalStreak, goalRunLength);
            previousGoalDate = day.date;
            lastGoalMetDate = day.date;
        }
    }

    const lastPracticeDate = days[days.length - 1].date;
    const yesterday = addClientDays(clientDate, -1);

    // Same ±1-day liveness rule the read path uses (effectivePracticeStreak).
    const isLive = (date: string | null): boolean =>
        date === clientDate || date === yesterday;

    return {
        streak: isLive(lastPracticeDate) ? runLength : 0,
        longestStreak,
        goalStreak: isLive(lastGoalMetDate) ? goalRunLength : 0,
        longestGoalStreak,
        wordsToday: days.find((day) => day.date === clientDate)?.words ?? 0,
        lastPracticeDate,
        lastGoalMetDate,
    };
}

/** Sum duplicate dates and sort ascending, so a batch has one entry per day. */
export function mergePracticeDays(
    days: { clientDate: string; wordCount: number }[],
): { clientDate: string; wordCount: number }[] {
    const byDate = new Map<string, number>();
    for (const day of days) {
        byDate.set(day.clientDate, (byDate.get(day.clientDate) ?? 0) + day.wordCount);
    }
    return [...byDate.entries()]
        .map(([clientDate, wordCount]) => ({ clientDate, wordCount }))
        .sort((a, b) => a.clientDate.localeCompare(b.clientDate));
}
