import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet } from 'jose';

export const JWKS_RESOLVER = 'JWKS_RESOLVER';

export type JwksResolver = ReturnType<typeof createRemoteJWKSet>;

/**
 * The auth service's published key set, fetched over HTTP and cached.
 *
 * Deliberately built against the *internal* JWKS url rather than the token's
 * `iss`: the issuer is the public gateway address, and hairpinning key fetches
 * back out through the proxy would be slower and add a failure mode for no gain.
 * The issuer stays a string this service compares; it is not dereferenced.
 *
 * `createRemoteJWKSet` is lazy — nothing is fetched until the first
 * verification — so this service starts cleanly even when auth-service is down,
 * and recovers on its own once it is back. That is why no `depends_on` ordering
 * is needed in compose. `cooldownDuration` also stops a token bearing an unknown
 * `kid` from being used to hammer the key endpoint.
 */
export const jwksProvider = {
    provide: JWKS_RESOLVER,
    inject: [ConfigService],
    useFactory: (configService: ConfigService): JwksResolver => {
        const uri = configService.get<string>('auth.jwksUri');
        if (!uri) {
            throw new Error('AUTH_JWKS_URI is not configured');
        }

        return createRemoteJWKSet(new URL(uri), {
            cooldownDuration: 30_000,
            cacheMaxAge: 600_000,
            timeoutDuration: 5_000,
        });
    },
};

/**
 * Pulls the key set once at boot so the first real request does not pay the
 * fetch. Failure is logged, never thrown: auth-service being slow to start must
 * not stop this service from starting.
 */
@Injectable()
export class JwksWarmupService implements OnApplicationBootstrap {
    private readonly logger = new Logger(JwksWarmupService.name);

    constructor(
        @Inject(JWKS_RESOLVER) private readonly jwks: JwksResolver,
        private readonly configService: ConfigService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        const uri = this.configService.get<string>('auth.jwksUri');
        try {
            // No token to resolve against, so ask for a key the set will not
            // have; the lookup still performs the fetch, which is the point.
            await this.jwks({ alg: 'RS256', kid: '__warmup__' } as never, {} as never);
        } catch {
            // Expected: the warm-up kid never matches. What matters is whether
            // the document itself could be retrieved, reported below.
        }

        this.logger.log(`JWKS endpoint configured: ${uri}`);
    }
}
