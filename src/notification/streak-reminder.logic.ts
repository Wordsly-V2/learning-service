/**
 * Pure helpers for the streak-reminder scheduler: resolving a user's local date
 * and time from an IANA timezone (DST-safe via Intl), and deciding whether a
 * reminder is due. No I/O.
 */

/** The user's local calendar date "YYYY-MM-DD" for an instant in their timezone. */
export function localDateInZone(now: Date, timezone: string): string {
    // en-CA formats as YYYY-MM-DD.
    try {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(now);
    } catch {
        return new Intl.DateTimeFormat('en-CA', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(now);
    }
}

/** The user's local time "HH:mm" (24h) for an instant in their timezone. */
export function localTimeInZone(now: Date, timezone: string): string {
    try {
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).format(now);
    } catch {
        return new Intl.DateTimeFormat('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).format(now);
    }
}

/** True when "HH:mm" a is at or after "HH:mm" b. */
export function timeReached(current: string, target: string): boolean {
    return current.localeCompare(target) >= 0;
}

export interface ReminderEligibilityInput {
    now: Date;
    timezone: string;
    reminderTime: string; // "HH:mm"
    /** The user-local date a reminder was last sent (YYYY-MM-DD) or null. */
    lastReminderSentDate: string | null;
}

export interface ReminderEligibility {
    localDate: string;
    /** Whether the local time has reached the reminder time and none sent today. */
    timeWindowOpen: boolean;
}

/** Resolve the time-window part of eligibility (streak-at-risk is checked separately). */
export function reminderTimeWindow(
    input: ReminderEligibilityInput,
): ReminderEligibility {
    const localDate = localDateInZone(input.now, input.timezone);
    const localTime = localTimeInZone(input.now, input.timezone);
    const alreadySentToday = input.lastReminderSentDate === localDate;
    return {
        localDate,
        timeWindowOpen:
            !alreadySentToday && timeReached(localTime, input.reminderTime),
    };
}
