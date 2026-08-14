import { Module } from '@nestjs/common';
import { SyncRequestService } from './sync-request.service';
import { SyncRequestCleanupService } from './sync-request.cleanup';

/**
 * Idempotency for client-replayed writes. Its own module so word-progress and
 * daily-habit can both depend on it without importing each other.
 */
@Module({
    providers: [SyncRequestService, SyncRequestCleanupService],
    exports: [SyncRequestService],
})
export class SyncModule {}
