import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
    IN_FLIGHT_STALE_MINUTES,
    SYNC_REQUEST_RETENTION_DAYS,
} from './sync-request.service';

/**
 * Daily sweep of the idempotency ledger. Retention is far longer than any client
 * retry horizon, and the `created_at` index keeps the delete cheap.
 */
@Injectable()
export class SyncRequestCleanupService {
    private readonly logger = new Logger(SyncRequestCleanupService.name);

    constructor(private readonly prisma: PrismaService) {}

    @Cron('17 3 * * *')
    async purgeOld(): Promise<void> {
        const now = Date.now();

        const expired = await this.prisma.syncRequest.deleteMany({
            where: {
                createdAt: {
                    lt: new Date(
                        now - SYNC_REQUEST_RETENTION_DAYS * 86_400_000,
                    ),
                },
            },
        });

        // A row left holding NULL belongs to a transaction that died before it
        // could store its response. Without this, that clientRequestId would 409
        // forever and the client could never flush it.
        const stale = await this.prisma.syncRequest.deleteMany({
            where: {
                response: { equals: Prisma.DbNull },
                createdAt: {
                    lt: new Date(now - IN_FLIGHT_STALE_MINUTES * 60_000),
                },
            },
        });

        if (expired.count || stale.count) {
            this.logger.log(
                `purged ${expired.count} expired and ${stale.count} stale in-flight sync_request rows`,
            );
        }
    }
}
