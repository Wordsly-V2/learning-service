import { AuthenticatedRequest } from './authenticated-request';
import { OwnerGuard } from './owner.guard';
import { ForbiddenException } from '@nestjs/common';

/**
 * Closes the hole where a user-scoped route trusted the id in its own URL.
 *
 * Before requests carried their own token, the only caller was a gateway that
 * filled that segment in from a token it had already verified. Now the segment
 * is client-supplied, so without this guard any authenticated user could read
 * another user's rows by editing the path.
 */
describe('OwnerGuard', () => {
    const guard = new OwnerGuard();
    const SUBJECT = '11111111-1111-1111-1111-111111111111';
    const OTHER = '22222222-2222-2222-2222-222222222222';

    const contextFor = (request: Partial<AuthenticatedRequest>) => {
        const req = { params: {}, ...request } as AuthenticatedRequest;
        return {
            request: req,
            context: {
                getType: () => 'http',
                switchToHttp: () => ({ getRequest: () => req }),
            } as never,
        };
    };

    it('allows a caller acting on their own id', () => {
        const { context } = contextFor({
            params: { userLoginId: SUBJECT },
            user: { sub: SUBJECT, sid: 's', jti: 'j' },
        });

        expect(guard.canActivate(context)).toBe(true);
    });

    it('rejects a caller acting on someone else', () => {
        const { context } = contextFor({
            params: { userLoginId: OTHER },
            user: { sub: SUBJECT, sid: 's', jti: 'j' },
        });

        expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('rewrites `me` to the token subject', () => {
        const { context, request } = contextFor({
            params: { userLoginId: 'me' },
            user: { sub: SUBJECT, sid: 's', jti: 'j' },
        });

        expect(guard.canActivate(context)).toBe(true);
        // Rewritten in place, and before pipes run — so a ParseUUIDPipe on the
        // same param sees a real UUID and controllers need no change.
        expect(request.params.userLoginId).toBe(SUBJECT);
    });

    it('leaves peer-service calls alone', () => {
        const { context, request } = contextFor({
            params: { userLoginId: OTHER },
            isInternalCall: true,
        });

        expect(guard.canActivate(context)).toBe(true);
        expect(request.params.userLoginId).toBe(OTHER);
    });

    it('ignores routes that are not user-scoped', () => {
        const { context } = contextFor({
            params: {},
            user: { sub: SUBJECT, sid: 's', jti: 'j' },
        });

        expect(guard.canActivate(context)).toBe(true);
    });

    it('refuses a user-scoped route with no identity attached', () => {
        const { context } = contextFor({ params: { userLoginId: 'me' } });

        expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
});
