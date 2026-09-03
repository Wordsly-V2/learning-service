import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
// Static imports only: this repo's Jest runs CJS, where a dynamic import()
// callback needs --experimental-vm-modules.
import { SignJWT, importPKCS8 } from 'jose';
import { JWKSNoMatchingKey } from 'jose/errors';
import type { KeyObject } from 'node:crypto';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { AccessGuard } from './access.guard';
import { AuthenticatedRequest } from './authenticated-request';

/**
 * The entry matrix for a service that verifies tokens against a remote key set.
 *
 * The case worth the most care is the last group: telling "this token is bad"
 * apart from "I could not reach the keys to check it". Answering 401 to a key
 * set outage would sign every learner out and wipe the offline cache they have
 * been practising against, so an unreachable endpoint must surface as 503.
 */
describe('AccessGuard', () => {
    const INTERNAL_TOKEN = 'shared-internal-token';
    const ISSUER = 'http://localhost:3000';
    const AUDIENCE = 'wordsly-api';
    const SUBJECT = '11111111-1111-1111-1111-111111111111';

    const config: Record<string, string> = {
        internalServiceToServiceToken: INTERNAL_TOKEN,
        'auth.issuer': ISSUER,
        'auth.audience': AUDIENCE,
    };

    let privateKey: Awaited<ReturnType<typeof importPKCS8>>;
    let publicKey: KeyObject;
    let jwks: jest.Mock;

    beforeAll(async () => {
        const pair = generateKeyPairSync('rsa', {
            modulusLength: 2048,
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
            publicKeyEncoding: { type: 'spki', format: 'pem' },
        });
        privateKey = await importPKCS8(pair.privateKey, 'RS256');
        // The guard only ever receives the *public* half, exactly as it would
        // from the published key set.
        publicKey = createPublicKey(pair.publicKey);
    });

    const sign = (claims: Record<string, unknown>, audience = AUDIENCE) =>
        new SignJWT(claims)
            .setProtectedHeader({ alg: 'RS256', kid: 'test' })
            .setIssuer(ISSUER)
            .setAudience(audience)
            .setJti('jti-1')
            .setIssuedAt()
            .setExpirationTime('15m')
            .sign(privateKey);

    const buildGuard = (metadata: Record<string, boolean> = {}) =>
        new AccessGuard(
            { getAllAndOverride: (key: string) => metadata[key] } as never,
            { get: (key: string) => config[key] } as never,
            jwks as never,
        );

    const contextFor = (request: Partial<AuthenticatedRequest>) => {
        const req = { headers: {}, params: {}, ...request } as AuthenticatedRequest;
        return {
            request: req,
            context: {
                getType: () => 'http',
                getHandler: () => () => undefined,
                getClass: () => class {},
                switchToHttp: () => ({ getRequest: () => req }),
            } as never,
        };
    };

    beforeEach(() => {
        jwks = jest.fn().mockResolvedValue(publicKey);
    });

    it('lets a @Public() route through with no credentials', async () => {
        const { context } = contextFor({});
        await expect(buildGuard({ isPublic: true }).canActivate(context)).resolves.toBe(true);
    });

    it('admits a peer service on the internal token, with no user attached', async () => {
        const { context, request } = contextFor({
            headers: { 'x-service-token': INTERNAL_TOKEN } as never,
        });

        await expect(buildGuard().canActivate(context)).resolves.toBe(true);
        expect(request.isInternalCall).toBe(true);
        expect(request.user).toBeUndefined();
    });

    it('rejects a wrong internal token instead of falling through to it', async () => {
        const { context } = contextFor({
            headers: { 'x-service-token': 'wrong' } as never,
        });
        await expect(buildGuard().canActivate(context)).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
    });

    it('attaches the verified identity for a valid access token', async () => {
        const token = await sign({ sub: SUBJECT, sid: 'session-1', typ: 'access' });
        const { context, request } = contextFor({
            headers: { authorization: `Bearer ${token}` } as never,
        });

        await expect(buildGuard().canActivate(context)).resolves.toBe(true);
        expect(request.user).toEqual({ sub: SUBJECT, sid: 'session-1', jti: 'jti-1' });
    });

    it('refuses a refresh token, which carries a different audience', async () => {
        const token = await sign(
            { sub: SUBJECT, sid: 'session-1', typ: 'refresh' },
            'wordsly-auth',
        );
        const { context } = contextFor({
            headers: { authorization: `Bearer ${token}` } as never,
        });

        await expect(buildGuard().canActivate(context)).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
    });

    it('refuses a token whose typ is not access even if the audience matches', async () => {
        // Belt and braces: were the audiences ever collapsed by configuration,
        // the explicit typ check still has to hold the line.
        const token = await sign({ sub: SUBJECT, sid: 'session-1', typ: 'refresh' });
        const { context } = contextFor({
            headers: { authorization: `Bearer ${token}` } as never,
        });

        await expect(buildGuard().canActivate(context)).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
    });

    it('refuses a token signed by a key the issuer does not publish', async () => {
        jwks.mockRejectedValue(new JWKSNoMatchingKey());
        const token = await sign({ sub: SUBJECT, sid: 'session-1', typ: 'access' });
        const { context } = contextFor({
            headers: { authorization: `Bearer ${token}` } as never,
        });

        await expect(buildGuard().canActivate(context)).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
    });

    it('rejects a request with no credentials at all', async () => {
        const { context } = contextFor({});
        await expect(buildGuard().canActivate(context)).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
    });

    it('answers 503, not 401, when the key set cannot be reached', async () => {
        // The whole point: a learner must not be signed out -- and must not have
        // their offline cache wiped -- because auth-service was briefly down.
        jwks.mockRejectedValue(
            Object.assign(new Error('fetch failed'), { code: 'ERR_JWKS_TIMEOUT' }),
        );
        const token = await sign({ sub: SUBJECT, sid: 'session-1', typ: 'access' });
        const { context } = contextFor({
            headers: { authorization: `Bearer ${token}` } as never,
        });

        await expect(buildGuard().canActivate(context)).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
    });

    it('answers 503 for an unclassified transport failure too', async () => {
        jwks.mockRejectedValue(new TypeError('fetch failed'));
        const token = await sign({ sub: SUBJECT, sid: 'session-1', typ: 'access' });
        const { context } = contextFor({
            headers: { authorization: `Bearer ${token}` } as never,
        });

        await expect(buildGuard().canActivate(context)).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
    });

    it('skips non-HTTP transports, which have no headers to check', async () => {
        await expect(
            buildGuard().canActivate({ getType: () => 'rpc' } as never),
        ).resolves.toBe(true);
    });
});
