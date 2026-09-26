import { isUUID } from 'class-validator';
import type { PathAchievementInput } from '@/learning-report/learning-report.logic';

/** A `path_progress` message from curriculum-service (totals, not deltas). */
export interface PathProgressEvent extends PathAchievementInput {
    userLoginId: string;
    occurredAt: Date;
}

/** Far above any real path; a bigger number is a broken producer. */
const MAX_TOTAL = 100_000;

const isCount = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_TOTAL;

/**
 * The event, or null when the message is not a usable one. Strict because the
 * totals turn into XP: a malformed message is dropped rather than guessed at.
 */
export function parsePathProgressPayload(
    payload: unknown,
): PathProgressEvent | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const p = payload as Record<string, unknown>;
    if (typeof p.userLoginId !== 'string' || !isUUID(p.userLoginId)) {
        return null;
    }
    if (
        !isCount(p.lessonsCompleted) ||
        !isCount(p.unitsCompleted) ||
        !isCount(p.stagesCompleted)
    ) {
        return null;
    }
    if (typeof p.occurredAt !== 'string') return null;
    const occurredAt = new Date(p.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) return null;
    return {
        userLoginId: p.userLoginId,
        lessonsCompleted: p.lessonsCompleted,
        unitsCompleted: p.unitsCompleted,
        stagesCompleted: p.stagesCompleted,
        occurredAt,
    };
}
