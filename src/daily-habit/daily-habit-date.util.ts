/** Parse YYYY-MM-DD into a UTC midnight Date (for @db.Date storage). */
export function parseClientDate(date: string): Date {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
}

export function formatClientDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function yesterdayClientDate(today: string): string {
    const parsed = parseClientDate(today);
    parsed.setUTCDate(parsed.getUTCDate() - 1);
    return formatClientDate(parsed);
}

export function datesEqual(a: Date, b: Date): boolean {
    return formatClientDate(a) === formatClientDate(b);
}
