import {
    CanActivate,
    ExecutionContext,
    Inject,
    Injectable,
    Logger,
    ServiceUnavailableException,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { jwtVerify } from 'jose';
import { AuthenticatedRequest } from './authenticated-request';
import { IS_PUBLIC_KEY } from './public.decorator';
import { JWKS_RESOLVER } from './jwks.provider';
// `import type` is required: JwksResolver appears in a decorated
// constructor signature, and emitDecoratorMetadata would otherwise try to
// emit a runtime reference to a type-only export.
import type { JwksResolver } from './jwks.provider';

/**
 * The single entry check for every route, registered globally.
 *
 * This service used to have no idea who a user was: it trusted a shared header
 * from the gateway and read the user id straight out of the URL. Tokens are now
 * verified here, against the auth service's published key set, so the identity
 * is established by cryptography rather than by trusting the caller.
 *
 * Two ways in:
 *   1. `@Public()` — health checks and the token endpoints.
 *   2. A valid access token — identity attached to the request for
 *      `@CurrentUser()` to read. Peer services forward the caller's own token,
 *      so they arrive here as the user they are acting for, not as a peer.
 */
@Injectable()
export class AccessGuard implements CanActivate {
    private readonly logger = new Logger(AccessGuard.name);

    constructor(
        private readonly reflector: Reflector,
        private readonly configService: ConfigService,
        @Inject(JWKS_RESOLVER) private readonly jwks: JwksResolver,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        // Kafka consumers have no headers to check and are not reachable from
        // outside the cluster.
        if (context.getType() !== 'http') return true;

        const isPublic = this.reflector.getAllAndOverride<boolean>(
            IS_PUBLIC_KEY,
            [context.getHandler(), context.getClass()],
        );
        if (isPublic) return true;

        const request = context
            .switchToHttp()
            .getRequest<AuthenticatedRequest>();

        const token = readBearerToken(request);
        if (!token) {
            throw new UnauthorizedException('Missing access token');
        }

        const payload = await this.verify(token);
        request.user = {
            sub: payload.sub,
            sid: payload.sid,
            jti: payload.jti,
        };
        return true;
    }

    private async verify(token: string): Promise<{
        sub: string;
        sid: string;
        jti: string;
    }> {
        try {
            const { payload } = await jwtVerify(token, this.jwks, {
                algorithms: ['RS256'],
                issuer: this.configService.get<string>('auth.issuer'),
                audience: this.configService.get<string>('auth.audience'),
                clockTolerance: 60,
            });

            // The audience check above already separates the two, but a refresh
            // token must never be spendable here, so say it twice.
            if (payload.typ !== 'access') {
                throw new UnauthorizedException('Expected an access token');
            }

            const sub =
                payload.sub ?? (payload.userLoginId as string | undefined);
            if (!sub) {
                throw new UnauthorizedException('Token has no subject');
            }

            return {
                sub,
                sid: (payload.sid as string | undefined) ?? '',
                jti: payload.jti ?? '',
            };
        } catch (error) {
            if (error instanceof UnauthorizedException) throw error;

            // "I could not check this token" is not "this token is bad".
            // Answering 401 to a key-set outage would sign every learner out and
            // wipe their offline cache over a few seconds of auth downtime, so
            // an unreachable key set has to surface as a server problem.
            if (!isTokenRejection(error)) {
                this.logger.error(
                    `Could not reach the JWKS endpoint: ${String(error)}`,
                );
                throw new ServiceUnavailableException(
                    'Unable to verify credentials right now',
                );
            }

            throw new UnauthorizedException('Invalid access token');
        }
    }
}

/**
 * Codes jose uses when the *token* is at fault, as opposed to the key set being
 * unreachable. Anything not on this list is treated as an outage.
 */
const TOKEN_REJECTION_CODES = new Set([
    'ERR_JWT_EXPIRED',
    'ERR_JWT_CLAIM_VALIDATION_FAILED',
    'ERR_JWT_INVALID',
    'ERR_JWS_INVALID',
    'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
    'ERR_JOSE_ALG_NOT_ALLOWED',
    // An unknown `kid` after a refresh means the token was signed by a key this
    // issuer no longer publishes — a bad token, not a broken endpoint.
    'ERR_JWKS_NO_MATCHING_KEY',
    'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
]);

function isTokenRejection(error: unknown): boolean {
    const code = (error as { code?: string })?.code;
    return typeof code === 'string' && TOKEN_REJECTION_CODES.has(code);
}

function readBearerToken(request: AuthenticatedRequest): string | null {
    const header = request.headers.authorization;
    if (!header) return null;

    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
    return value;
}
