import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';

/**
 * PrismaModule and CacheModule are @Global, so only Terminus needs importing.
 */
@Module({
    imports: [TerminusModule],
    controllers: [HealthController],
})
export class HealthModule {}
