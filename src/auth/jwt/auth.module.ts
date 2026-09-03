import { Global, Module } from '@nestjs/common';
import { JwksWarmupService, jwksProvider } from './jwks.provider';

/**
 * Global because the access guard is global: every route's entry check needs
 * the key set, not just one feature module.
 */
@Global()
@Module({
    providers: [jwksProvider, JwksWarmupService],
    exports: [jwksProvider],
})
export class AuthModule {}
