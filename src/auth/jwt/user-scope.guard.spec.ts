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
    const guard = new UserScopeGuard();

    const contextFor = (request: Record<string, unknown>) =>
        ({
            getType: () => 'http',
            switchToHttp: () => ({ getRequest: () => request }),
        }) as never;

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

    it('skips non-HTTP transports, which have no caller to distrust', () => {
        // Kafka consumers reach handlers with no params and no query at all.
        expect(guard.canActivate({ getType: () => 'rpc' } as never)).toBe(true);
    });

    it('tolerates a request with no params or query object', () => {
        expect(guard.canActivate(contextFor({}))).toBe(true);
    });
});
