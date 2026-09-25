import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedRequest } from './authenticated-request';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
    const buildGuard = (required: string[] | undefined) =>
        new RolesGuard({ getAllAndOverride: () => required } as never);

    const contextFor = (user?: AuthenticatedRequest['user'], type = 'http') =>
        ({
            getType: () => type,
            getHandler: () => () => undefined,
            getClass: () => class {},
            switchToHttp: () => ({ getRequest: () => ({ user }) }),
        }) as never;

    const user = (roles: string[]) => ({
        sub: 'user-1',
        sid: 'session-1',
        jti: 'jti-1',
        roles,
    });

    it('lets any caller through a route without @Roles()', () => {
        expect(buildGuard(undefined).canActivate(contextFor(user([])))).toBe(
            true,
        );
    });

    it('admits a caller holding one of the required roles', () => {
        expect(
            buildGuard(['admin']).canActivate(contextFor(user(['admin']))),
        ).toBe(true);
    });

    it('refuses a caller without the role with 403, not 401', () => {
        expect(() =>
            buildGuard(['admin']).canActivate(contextFor(user([]))),
        ).toThrow(ForbiddenException);
    });

    it('refuses when no identity was attached', () => {
        expect(() =>
            buildGuard(['admin']).canActivate(contextFor(undefined)),
        ).toThrow(ForbiddenException);
    });

    it('does not apply to non-HTTP contexts such as Kafka consumers', () => {
        expect(
            buildGuard(['admin']).canActivate(contextFor(undefined, 'rpc')),
        ).toBe(true);
    });
});
