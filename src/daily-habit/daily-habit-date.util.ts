import { ValidateBy, ValidationOptions } from 'class-validator';

const CLIENT_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

const MS_PER_DAY = 86_400_000;

/** How far the client's claimed "today" may differ from the server date. */
const MAX_CLIENT_TODAY_DRIFT_DAYS = 1;

/**
 * Whether `value` is a real YYYY-MM-DD calendar date.
 *
 * The shape alone is not enough: `Date.UTC` silently normalises out-of-range
 * parts, so `2026-02-31` would become 2026-03-03 and a learner's practice
 * would land on a day they never claimed. Round-tripping through `Date`
 * catches every such overflow (bad month, bad day, Feb 29 off a leap year).
 */
export function isValidClientDate(value: unknown): value is string {
    if (typeof value !== 'string' || !CLIENT_DATE_SHAPE.test(value)) {
        return false;
    }
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return formatClientDate(parsed) === value;
}

/** class-validator decorator: a real YYYY-MM-DD calendar date (see above). */
export function IsClientDate(options?: ValidationOptions): PropertyDecorator {
    return ValidateBy(
        {
            name: 'isClientDate',
            validator: {
                validate: (value) => isValidClientDate(value),
                defaultMessage: (args) =>
                    `${args?.property ?? 'date'} must be a real calendar date in YYYY-MM-DD format`,
            },
        },
        options,
    );
}

/**
 * Parse YYYY-MM-DD into a UTC midnight Date (for @db.Date storage).
 *
 * Throws on an impossible date rather than shifting it. Every client-supplied
 * date is rejected with a 400 by `@IsClientDate()` before it gets here, so a
 * throw means an unvalidated path — better loud than a silently moved day.
 */
export function parseClientDate(date: string): Date {
    if (!isValidClientDate(date)) {
        throw new RangeError(`Invalid client date: ${date}`);
    }
    const [year, month, day] = date.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
}

/**
 * The UTC calendar date of an instant.
 *
 * Note that this is what every "today" defaults to when a client omits
 * `clientDate` and gives no UTC offset: without either we cannot know the
 * learner's midnight, so the server's UTC date is the only honest answer. For a
 * learner far from UTC that is a different day for part of every day, which is
 * why clients are expected to send `clientDate`.
 */
export function formatClientDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/**
 * The client's "today", sanity-bounded. More than a day away from the server
 * date is nonsense, and letting it through would allow backdating `clientDate`
 * to farm a stale goal-streak XP multiplier or to relocate practice onto an
 * arbitrary day.
 *
 * With no `clientDate`, `tzOffsetMinutes` (minutes to ADD to UTC for local
 * wall-clock time) derives the learner's local date when the caller has one;
 * otherwise the server's UTC date is used (see formatClientDate). A real offset
 * is at most ±14h, so the derived date is always inside the drift window.
 */
export function resolveClientToday(
    clientDate: string | undefined,
    now: Date,
    tzOffsetMinutes?: number,
): string {
    const serverToday = formatClientDate(now);
    if (clientDate === undefined) {
        return tzOffsetMinutes === undefined
            ? serverToday
            : formatClientDate(
                  new Date(now.getTime() + tzOffsetMinutes * 60_000),
              );
    }

    const drift = Math.abs(
        (parseClientDate(clientDate).getTime() -
            parseClientDate(serverToday).getTime()) /
            MS_PER_DAY,
    );

    return drift > MAX_CLIENT_TODAY_DRIFT_DAYS ? serverToday : clientDate;
}

export function yesterdayClientDate(today: string): string {
    const parsed = parseClientDate(today);
    parsed.setUTCDate(parsed.getUTCDate() - 1);
    return formatClientDate(parsed);
}

export function datesEqual(a: Date, b: Date): boolean {
    return formatClientDate(a) === formatClientDate(b);
}
