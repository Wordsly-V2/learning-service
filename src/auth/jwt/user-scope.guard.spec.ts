import { BadRequestException } from '@nestjs/common';
import { UserScopeGuard } from './user-scope.guard';

/**
 * The guard that replaced OwnerGuard.
 *
 * OwnerGuard compared a `:userLoginId` segment against the token and returned
 * true for every route that did not have one — so a route spelling the param
 * `:userId` was simply never checked, and nothing would have said so. Handlers
 * now take the id from the token, which makes any caller-supplied user id
 * meaningless; these cases pin that it is refused rather than quietly ignored.
 */
describe('UserScopeGuard', () => {
    /** `required` is what `@Roles(...)` put on the route, if anything. */
    const buildGuard = (required?: string[]) =>
        new UserScopeGuard({ getAllAndOverride: () => required } as never);

    const guard = buildGuard();

    const contextFor = (request: Record<string, unknown>) =>
        ({
            getType: () => 'http',
            getHandler: () => () => undefined,
            getClass: () => class {},
            switchToHttp: () => ({ getRequest: () => request }),
        }) as never;

    const callerWith = (roles: string[]) => ({
        sub: 'caller',
        sid: 's',
        jti: 'j',
        roles,
    });

    it('allows an ordinary request that names nobody', () => {
        expect(
            guard.canActivate(
                contextFor({
                    params: { courseId: 'c1' },
                    query: { page: '2' },
                }),
            ),
        ).toBe(true);
    });

    it.each([
        [
            'the retired route param',
            { params: { userLoginId: 'other' }, query: {} },
        ],
        ['a query string', { params: {}, query: { userLoginId: 'other' } }],
        [
            'a differently spelled param',
            { params: { userId: 'other' }, query: {} },
        ],
        ['snake case', { params: {}, query: { user_id: 'other' } }],
    ])('refuses a user id supplied through %s', (_label, request) => {
        expect(() => guard.canActivate(contextFor(request))).toThrow(
            BadRequestException,
        );
    });

    it('names the offending key so the caller can fix it', () => {
        expect(() =>
            guard.canActivate(
                contextFor({ params: {}, query: { userLoginId: 'x' } }),
            ),
        ).toThrow(/userLoginId/);
    });

    describe('admin routes', () => {
        const adminRoute = buildGuard(['admin']);
        const naming = { params: { userId: 'target' }, query: {} };

        it('lets an admin name the user an @Roles("admin") route acts on', () => {
            expect(
                adminRoute.canActivate(
                    contextFor({ ...naming, user: callerWith(['admin']) }),
                ),
            ).toBe(true);
        });

        it('still refuses a non-admin, even if RolesGuard were skipped', () => {
            expect(() =>
                adminRoute.canActivate(
                    contextFor({ ...naming, user: callerWith([]) }),
                ),
            ).toThrow(BadRequestException);
        });

        it('does not exempt an admin on an ordinary route', () => {
            expect(() =>
                guard.canActivate(
                    contextFor({ ...naming, user: callerWith(['admin']) }),
                ),
            ).toThrow(BadRequestException);
        });

        it('does not exempt a route that requires some other role', () => {
            expect(() =>
                buildGuard(['editor']).canActivate(
                    contextFor({ ...naming, user: callerWith(['admin']) }),
                ),
            ).toThrow(BadRequestException);
        });
    });

    it('skips non-HTTP transports, which have no caller to distrust', () => {
        // Kafka consumers reach handlers with no params and no query at all.
        expect(guard.canActivate({ getType: () => 'rpc' } as never)).toBe(true);
    });

    it('tolerates a request with no params or query object', () => {
        expect(guard.canActivate(contextFor({}))).toBe(true);
    });
});
