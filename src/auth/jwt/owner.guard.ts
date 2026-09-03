import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { AuthenticatedRequest } from './authenticated-request';

/** Route param naming the user a request is acting on. */
export const USER_SCOPE_PARAM = 'userLoginId';

/** Alias a caller may use in place of their own id. */
export const SELF_ALIAS = 'me';

/**
 * Ties a user-scoped route to the identity that actually presented the token.
 *
 * Routes here are shaped `users/:userLoginId/...` and used to trust that path
 * segment outright, because the only caller was a gateway that filled it in from
 * a token it had already verified. Now that requests arrive with their own
 * token, the segment is client-supplied — without this guard any authenticated
 * user could read or write another user's rows by editing the URL.
 *
 * It also resolves the `me` alias, which has to happen in a guard rather than a
 * pipe or middleware: guards run before pipes, so a `ParseUUIDPipe` on the same
 * param still sees a real UUID and existing controllers need no change.
 *
 * Registered after AccessGuard, which is what puts `user` on the request.
 */
@Injectable()
export class OwnerGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        if (context.getType() !== 'http') return true;

        const request = context
            .switchToHttp()
            .getRequest<AuthenticatedRequest>();

        // A peer service acts on behalf of no one in particular; scoping is the
        // calling service's responsibility there, not this guard's.
        if (request.isInternalCall) return true;

        const params = request.params as Record<string, string | undefined>;
        const scoped = params?.[USER_SCOPE_PARAM];
        if (!scoped) return true;

        const subject = request.user?.sub;
        if (!subject) throw new ForbiddenException();

        if (scoped === SELF_ALIAS) {
            params[USER_SCOPE_PARAM] = subject;
            return true;
        }

        if (scoped !== subject) {
            throw new ForbiddenException('Cannot act on behalf of another user');
        }

        return true;
    }
}
