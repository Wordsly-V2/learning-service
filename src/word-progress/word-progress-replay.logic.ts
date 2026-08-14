import {
    formatClientDate,
    parseClientDate,
} from '@/daily-habit/daily-habit-date.util';
import { AnswerQuality } from './dto/word-progress.dto';

/**
 * Clock policy for replayed offline answers.
 *
 * Offline clients send the instant each answer actually happened so FSRS can
 * schedule from the review rather than from sync time. That instant is client
 * data, so it is untrusted: forward-dating would skip intervals and backdating
 * would relocate XP. Everything here bounds that damage without ever throwing
 * away a legitimate answer — a 400 on a flush of 200 good answers plus one
 * skewed clock loses real learning, so we clamp instead.
 */

/** Answers claiming to be past this far beyond server now are clock skew. */
export const MAX_FUTURE_SKEW_MS = 2 * 60_000;

/** Oldest an offline answer may claim to be; anything older is clamped forward. */
export const MAX_BACKDATE_DAYS = 14;

/**
 * Distinct local calendar dates one flush may span.
 *
 * A backstop rather than the operative rule: MAX_BACKDATE_DAYS already bounds a
 * batch to ~15 dates, so this only bites if that window is widened later. Kept so
 * widening it cannot silently admit a month-spanning forgery.
 */
export const MAX_BATCH_DATES = 30;

/** How far the client's claimed "today" may differ from the server date. */
const MAX_CLIENT_TODAY_DRIFT_DAYS = 1;

const MS_PER_DAY = 86_400_000;

export interface ReplayAnswerInput {
    wordId: string;
    quality: AnswerQuality;
    reviewedAt?: string;
}

export interface ReplayAnswer {
    wordId: string;
    quality: AnswerQuality;
    /** Server-resolved review instant (already clamped). */
    reviewedAt: Date;
    /** Local calendar date (YYYY-MM-DD) this answer counts toward. */
    reviewDate: string;
    /** True when the client sent no reviewedAt (legacy client). */
    inferred: boolean;
}

export interface ClampReport {
    clampedFuture: number;
    clampedPast: number;
    inferred: number;
    /** Distinct review dates in the batch, ascending. */
    dates: string[];
    /** Calendar days spanned from the earliest to the latest review date. */
    spanDays: number;
}

/**
 * Clamp one client instant into [now - MAX_BACKDATE_DAYS, now + skew].
 *
 * Forward-dating is neutralised entirely (clamped back to `now`), so a client
 * cannot claim a review happened later than it did in order to satisfy an
 * interval it has not waited out.
 */
export function clampReviewedAt(
    raw: string | undefined,
    now: Date,
): { at: Date; inferred: boolean; clamped: 'future' | 'past' | null } {
    if (raw === undefined) {
        return { at: new Date(now), inferred: true, clamped: null };
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
        // Validation already rejects malformed values; treat anything that slips
        // through as "no client time" rather than crashing a whole flush.
        return { at: new Date(now), inferred: true, clamped: null };
    }

    if (parsed.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) {
        return { at: new Date(now), inferred: false, clamped: 'future' };
    }

    const floor = now.getTime() - MAX_BACKDATE_DAYS * MS_PER_DAY;
    if (parsed.getTime() < floor) {
        return { at: new Date(floor), inferred: false, clamped: 'past' };
    }

    return { at: parsed, inferred: false, clamped: null };
}

/**
 * Local calendar date for an instant, using the client's UTC offset when
 * supplied. Without an offset we cannot know the user's midnight, so every
 * answer falls back to the single `clientDate` the client sent — which is
 * exactly the pre-offline behaviour.
 */
export function resolveAnswerDate(
    at: Date,
    tzOffsetMinutes: number | undefined,
    fallbackClientDate: string,
): string {
    if (tzOffsetMinutes === undefined) {
        return fallbackClientDate;
    }
    return formatClientDate(new Date(at.getTime() + tzOffsetMinutes * 60_000));
}

/**
 * The client's "today", sanity-bounded. More than a day away from the server
 * date is nonsense, and letting it through would allow backdating `clientDate`
 * to farm a stale goal-streak XP multiplier.
 */
export function resolveClientToday(
    clientDate: string | undefined,
    now: Date,
): string {
    const serverToday = formatClientDate(now);
    if (clientDate === undefined) {
        return serverToday;
    }

    const drift = Math.abs(
        (parseClientDate(clientDate).getTime() -
            parseClientDate(serverToday).getTime()) /
            MS_PER_DAY,
    );

    return drift > MAX_CLIENT_TODAY_DRIFT_DAYS ? serverToday : clientDate;
}

function dayDiff(from: string, to: string): number {
    return Math.round(
        (parseClientDate(to).getTime() - parseClientDate(from).getTime()) /
            MS_PER_DAY,
    );
}

/**
 * Normalise a bulk batch for replay: clamp every instant, derive per-answer
 * calendar dates, drop exact (wordId, quality, reviewedAt) triplicates, and
 * sort ascending by reviewedAt.
 *
 * The sort is what makes intraday repeats work — the service replays answers in
 * this order, chaining each card's state, so an offline "Again → Again → Good"
 * advances FSRS learning steps instead of collapsing to the last grade. Answers
 * with no client instant are all stamped `now` and therefore sort last, which
 * keeps legacy single-session flushes in their original order.
 */
export function prepareReplayBatch(params: {
    answers: ReplayAnswerInput[];
    tzOffsetMinutes?: number;
    /** Already validated/clamped by the caller (see resolveClientToday). */
    clientDate: string;
    now: Date;
}): { answers: ReplayAnswer[]; report: ClampReport } {
    const { answers, tzOffsetMinutes, clientDate, now } = params;

    const report: ClampReport = {
        clampedFuture: 0,
        clampedPast: 0,
        inferred: 0,
        dates: [],
        spanDays: 0,
    };

    const seen = new Set<string>();
    const prepared: { answer: ReplayAnswer; index: number }[] = [];

    answers.forEach((answer, index) => {
        const { at, inferred, clamped } = clampReviewedAt(
            answer.reviewedAt,
            now,
        );

        if (clamped === 'future') {
            report.clampedFuture++;
        } else if (clamped === 'past') {
            report.clampedPast++;
        }
        if (inferred) {
            report.inferred++;
        }

        // Only an exact triplicate is a duplicate. The same word at a different
        // instant is a genuine second review and must be replayed as one.
        const fingerprint = `${answer.wordId}|${answer.quality}|${at.getTime()}`;
        if (seen.has(fingerprint)) {
            return;
        }
        seen.add(fingerprint);

        prepared.push({
            index,
            answer: {
                wordId: answer.wordId,
                quality: answer.quality,
                reviewedAt: at,
                reviewDate: resolveAnswerDate(at, tzOffsetMinutes, clientDate),
                inferred,
            },
        });
    });

    // Stable ascending sort: original order breaks ties so a client that sent
    // several answers on the same millisecond keeps its sequence.
    prepared.sort((a, b) => {
        const delta =
            a.answer.reviewedAt.getTime() - b.answer.reviewedAt.getTime();
        return delta !== 0 ? delta : a.index - b.index;
    });

    const sorted = prepared.map((entry) => entry.answer);
    report.dates = [...new Set(sorted.map((a) => a.reviewDate))].sort();
    report.spanDays =
        report.dates.length > 1
            ? dayDiff(report.dates[0], report.dates[report.dates.length - 1])
            : 0;

    return { answers: sorted, report };
}
