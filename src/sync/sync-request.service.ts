import { PrismaService } from '@/prisma/prisma.service';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** How long a replay of the same clientRequestId is honoured. */
export const SYNC_REQUEST_RETENTION_DAYS = 30;

/**
 * A stored response larger than this is dropped. The client refetches instead,
 * which is the acceptable degenerate case for a very large flush.
 */
export const MAX_STORED_RESPONSE_BYTES = 256 * 1024;

/** A row still holding NULL after this long belongs to a crashed transaction. */
export const IN_FLIGHT_STALE_MINUTES = 10;

export const SYNC_ENDPOINT_BULK_ANSWERS = 'word-progress.bulk-sync';
export const SYNC_ENDPOINT_HABIT_BATCH =
    'daily-habit.record-practice-batch';

function isUniqueViolation(error: unknown): boolean {
    return (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
    );
}

/**
 * Runs a write exactly once per (userLoginId, clientRequestId).
 *
 * Offline clients retry flushes, and a retry after a lost response used to
 * double-apply XP and re-advance FSRS. This is the guard.
 */
@Injectable()
export class SyncRequestService {
    private readonly logger = new Logger(SyncRequestService.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Run `work` exactly once for this request id.
     *
     * The ledger row is INSERTed as the first statement of the same transaction
     * as the work — not read beforehand. A read-then-write check has a TOCTOU
     * window in which two concurrent flushes of the same id both see "not
     * present" and both award XP. Insert-first makes the primary key the lock:
     * the second inserter blocks on the first's uncommitted row, then fails with
     * P2002 and rolls back having changed nothing.
     *
     * With no `clientRequestId` the work simply runs unprotected, exactly as it
     * did before — that is what keeps older clients working.
     */
    async runOnce<T extends object>(
        userLoginId: string,
        clientRequestId: string | undefined,
        endpoint: string,
        work: (tx: Prisma.TransactionClient) => Promise<T>,
        options?: {
            maxWait?: number;
            timeout?: number;
            /**
             * Response to replay when the stored one was too large to keep. The
             * client is expected to refetch after receiving it.
             */
            emptyOnTruncated?: () => T;
        },
    ): Promise<T & { replayed?: boolean }> {
        const txOptions = options && {
            maxWait: options.maxWait,
            timeout: options.timeout,
        };

        if (!clientRequestId) {
            return this.prisma.$transaction(work, txOptions);
        }

        try {
            return await this.prisma.$transaction(async (tx) => {
                await tx.syncRequest.create({
                    data: { userLoginId, clientRequestId, endpoint },
                });

                const result = await work(tx);

                const serialised = this.serialise(result);
                await tx.syncRequest.update({
                    where: {
                        userLoginId_clientRequestId: {
                            userLoginId,
                            clientRequestId,
                        },
                    },
                    data: { response: serialised },
                });

                return result;
            }, txOptions);
        } catch (error) {
            if (!isUniqueViolation(error)) {
                throw error;
            }
            return this.replay<T>(
                userLoginId,
                clientRequestId,
                endpoint,
                options?.emptyOnTruncated,
            );
        }
    }

    /**
     * Return the original response for an already-applied request. The client
     * needs the real body — per-word intervals and next review dates to update
     * its offline cache, plus the level event — and forcing it to refetch would
     * mean another round trip on exactly the flaky network that caused the retry.
     */
    private async replay<T extends object>(
        userLoginId: string,
        clientRequestId: string,
        endpoint: string,
        emptyOnTruncated?: () => T,
    ): Promise<T & { replayed: true }> {
        const row = await this.prisma.syncRequest.findUnique({
            where: {
                userLoginId_clientRequestId: { userLoginId, clientRequestId },
            },
        });

        if (!row) {
            // Lost the insert race, then the winner's row was swept away.
            throw new ConflictException('Sync request vanished; retry.');
        }

        if (row.endpoint !== endpoint) {
            throw new ConflictException(
                'clientRequestId was already used for a different operation',
            );
        }

        if (row.response === null) {
            throw new ConflictException(
                'Sync request is still in flight; retry shortly.',
            );
        }

        const stored = row.response as Record<string, unknown>;
        if (stored.__truncated === true) {
            this.logger.warn('Replaying a truncated sync response', {
                userLoginId,
                clientRequestId,
                endpoint,
            });
            if (!emptyOnTruncated) {
                throw new ConflictException(
                    'Sync request already applied; refetch current state.',
                );
            }
            return { ...emptyOnTruncated(), replayed: true };
        }

        return { ...(stored as T), replayed: true };
    }

    private serialise(result: object): Prisma.InputJsonValue {
        const json = JSON.stringify(result);
        if (json.length > MAX_STORED_RESPONSE_BYTES) {
            return { __truncated: true };
        }
        return JSON.parse(json) as Prisma.InputJsonValue;
    }
}
