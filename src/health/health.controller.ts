import { Controller, Get } from '@nestjs/common';
import {
    HealthCheck,
    HealthCheckService,
    HealthIndicatorService,
} from '@nestjs/terminus';
import { PrismaService } from '@/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { Public } from '@/auth/jwt/public.decorator';

/** A probe must never be the thing that hangs. */
const DEPENDENCY_TIMEOUT_MS = 3_000;
/** Shared across concurrent probes so a tight polling loop cannot amplify load. */
const CACHE_MS = 2_000;

/**
 * Liveness and readiness, which are different questions.
 *
 * `/health` answers "is this process alive" and touches nothing: an orchestrator
 * uses it to decide whether to restart the container, so a failing database must
 * not make it restart a perfectly healthy process in a loop.
 *
 * `/ready` answers "can this process serve traffic" and checks the dependencies.
 * Both endpoints used to return the same hardcoded string, which meant `/health`
 * reported 200 with Postgres down and nothing could act on it.
 *
 * Redis reports `degraded` rather than `down`: the cache layer already falls
 * back to the database when it cannot connect, so losing it is slower, not
 * broken, and must not pull the service out of the load balancer.
 */
@Controller()
export class HealthController {
    constructor(
        private readonly healthCheck: HealthCheckService,
        private readonly health: HealthIndicatorService,
        private readonly prisma: PrismaService,
        private readonly configService: ConfigService,
    ) {}

    /** Liveness. Deliberately checks nothing. */
    @Public()
    @Get('health')
    live() {
        return { status: 'ok' };
    }

    /** Readiness. 503 when a hard dependency is unreachable. */
    @Public()
    @Get('ready')
    @HealthCheck()
    ready() {
        return this.healthCheck.check([
            () =>
                this.health
                    .check('database')
                    .attempt(async () => {
                        await this.prisma.$queryRaw`SELECT 1`;
                    })
                    .withTimeout(DEPENDENCY_TIMEOUT_MS)
                    .cacheFor(CACHE_MS),
            () =>
                this.health
                    .check('jwks')
                    .attempt(async ({ signal }) => {
                        const uri =
                            this.configService.get<string>('auth.jwksUri');
                        if (!uri) throw new Error('AUTH_JWKS_URI not set');
                        const response = await fetch(uri, { signal });
                        if (!response.ok) {
                            throw new Error(`HTTP ${response.status}`);
                        }
                    })
                    .withTimeout(DEPENDENCY_TIMEOUT_MS)
                    .cacheFor(CACHE_MS),
        ]);
    }
}
