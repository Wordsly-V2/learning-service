import { AnswerQuality } from './dto/word-progress.dto';
import {
    clampReviewedAt,
    MAX_BACKDATE_DAYS,
    MAX_FUTURE_SKEW_MS,
    prepareReplayBatch,
    resolveAnswerDate,
    resolveClientToday,
} from './word-progress-replay.logic';

const NOW = new Date('2026-08-13T10:00:00.000Z');
const MS_PER_DAY = 86_400_000;
const WORD_A = '01936b3e-7c8f-7890-abcd-ef1234567890';
const WORD_B = '01936b3e-7c8f-7890-abcd-ef1234567891';

describe('clampReviewedAt', () => {
    it('treats a missing instant as "now", flagged inferred', () => {
        const result = clampReviewedAt(undefined, NOW);

        expect(result.at).toEqual(NOW);
        expect(result.inferred).toBe(true);
        expect(result.clamped).toBeNull();
    });

    it('passes through an instant within the future skew window', () => {
        const at = new Date(NOW.getTime() + MAX_FUTURE_SKEW_MS - 1_000);

        const result = clampReviewedAt(at.toISOString(), NOW);

        expect(result.at).toEqual(at);
        expect(result.clamped).toBeNull();
    });

    it('clamps an instant beyond the skew window back to now', () => {
        const at = new Date(NOW.getTime() + 6 * 60 * 60 * 1000);

        const result = clampReviewedAt(at.toISOString(), NOW);

        expect(result.at).toEqual(NOW);
        expect(result.clamped).toBe('future');
    });

    it('passes through an instant 13 days old', () => {
        const at = new Date(NOW.getTime() - 13 * MS_PER_DAY);

        const result = clampReviewedAt(at.toISOString(), NOW);

        expect(result.at).toEqual(at);
        expect(result.clamped).toBeNull();
    });

    it('clamps an instant older than the backdate limit forward', () => {
        const at = new Date(NOW.getTime() - 40 * MS_PER_DAY);

        const result = clampReviewedAt(at.toISOString(), NOW);

        expect(result.at).toEqual(
            new Date(NOW.getTime() - MAX_BACKDATE_DAYS * MS_PER_DAY),
        );
        expect(result.clamped).toBe('past');
    });
});

describe('resolveAnswerDate', () => {
    it('uses the client fallback date when no timezone offset is given', () => {
        const at = new Date('2026-08-11T18:30:00.000Z');

        expect(resolveAnswerDate(at, undefined, '2026-08-13')).toBe(
            '2026-08-13',
        );
    });

    it('shifts an evening UTC instant forward for a +07:00 client', () => {
        const at = new Date('2026-08-11T18:30:00.000Z');

        expect(resolveAnswerDate(at, 420, '2026-08-13')).toBe('2026-08-12');
    });

    it('keeps the same day for a -05:00 client', () => {
        const at = new Date('2026-08-11T18:30:00.000Z');

        expect(resolveAnswerDate(at, -300, '2026-08-13')).toBe('2026-08-11');
    });
});

describe('resolveClientToday', () => {
    it('defaults to the server date when the client sent none', () => {
        expect(resolveClientToday(undefined, NOW)).toBe('2026-08-13');
    });

    it('accepts a date within a day of the server date', () => {
        expect(resolveClientToday('2026-08-14', NOW)).toBe('2026-08-14');
        expect(resolveClientToday('2026-08-12', NOW)).toBe('2026-08-12');
    });

    it('falls back to the server date when the client date is 3 days off', () => {
        // Otherwise a client could backdate "today" to farm a stale goal-streak
        // XP multiplier.
        expect(resolveClientToday('2026-08-10', NOW)).toBe('2026-08-13');
    });
});

describe('prepareReplayBatch', () => {
    const prepare = (answers: Parameters<typeof prepareReplayBatch>[0]['answers'], tzOffsetMinutes?: number) =>
        prepareReplayBatch({
            answers,
            tzOffsetMinutes,
            clientDate: '2026-08-13',
            now: NOW,
        });

    it('sorts ascending by review instant', () => {
        const { answers } = prepare([
            {
                wordId: WORD_A,
                quality: AnswerQuality.PERFECT,
                reviewedAt: '2026-08-13T09:30:00.000Z',
            },
            {
                wordId: WORD_B,
                quality: AnswerQuality.PERFECT,
                reviewedAt: '2026-08-13T08:00:00.000Z',
            },
        ]);

        expect(answers.map((a) => a.wordId)).toEqual([WORD_B, WORD_A]);
    });

    it('sorts answers with no instant last', () => {
        // They are stamped `now`, which is later than any legitimate past
        // instant, so legacy flushes keep their original relative order.
        const { answers } = prepare([
            { wordId: WORD_A, quality: AnswerQuality.PERFECT },
            {
                wordId: WORD_B,
                quality: AnswerQuality.PERFECT,
                reviewedAt: '2026-08-13T08:00:00.000Z',
            },
        ]);

        expect(answers.map((a) => a.wordId)).toEqual([WORD_B, WORD_A]);
        expect(answers[1].inferred).toBe(true);
    });

    it('collapses an exact triplicate', () => {
        const { answers } = prepare([
            {
                wordId: WORD_A,
                quality: AnswerQuality.PERFECT,
                reviewedAt: '2026-08-13T09:00:00.000Z',
            },
            {
                wordId: WORD_A,
                quality: AnswerQuality.PERFECT,
                reviewedAt: '2026-08-13T09:00:00.000Z',
            },
        ]);

        expect(answers).toHaveLength(1);
    });

    it('keeps the same word answered at different instants', () => {
        // This is the intraday-repeat case: three attempts in one offline
        // session are three real reviews, not one.
        const { answers } = prepare([
            {
                wordId: WORD_A,
                quality: AnswerQuality.COMPLETE_BLACKOUT,
                reviewedAt: '2026-08-13T09:00:00.000Z',
            },
            {
                wordId: WORD_A,
                quality: AnswerQuality.COMPLETE_BLACKOUT,
                reviewedAt: '2026-08-13T09:11:00.000Z',
            },
            {
                wordId: WORD_A,
                quality: AnswerQuality.CORRECT_WITH_HESITATION,
                reviewedAt: '2026-08-13T09:22:00.000Z',
            },
        ]);

        expect(answers).toHaveLength(3);
    });

    it('reports per-date grouping and span for a multi-day batch', () => {
        const { answers, report } = prepare(
            [
                {
                    wordId: WORD_A,
                    quality: AnswerQuality.PERFECT,
                    reviewedAt: '2026-08-11T03:00:00.000Z',
                },
                {
                    wordId: WORD_B,
                    quality: AnswerQuality.PERFECT,
                    reviewedAt: '2026-08-13T03:00:00.000Z',
                },
            ],
            420,
        );

        expect(report.dates).toEqual(['2026-08-11', '2026-08-13']);
        expect(report.spanDays).toBe(2);
        expect(answers[0].reviewDate).toBe('2026-08-11');
    });

    it('counts clamps in the report', () => {
        const { report } = prepare([
            {
                wordId: WORD_A,
                quality: AnswerQuality.PERFECT,
                reviewedAt: '2026-09-01T00:00:00.000Z',
            },
            {
                wordId: WORD_B,
                quality: AnswerQuality.PERFECT,
                reviewedAt: '2026-01-01T00:00:00.000Z',
            },
        ]);

        expect(report.clampedFuture).toBe(1);
        expect(report.clampedPast).toBe(1);
    });
});
