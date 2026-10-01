import { isUUID } from 'class-validator';

/**
 * The deleted user's id from a `user_deleted` message, or null when the
 * message is not a usable `{ userLoginId: uuid }`. Strict on purpose: the id
 * goes into `deleteMany` on every table, and Prisma reads
 * `{ userLoginId: undefined }` as "no filter", which would empty them.
 */
export function parseUserDeletedPayload(payload: unknown): string | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const id = (payload as Record<string, unknown>).userLoginId;
    return typeof id === 'string' && isUUID(id) ? id : null;
}
