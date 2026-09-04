import {
    BadRequestException,
    CanActivate,
    ExecutionContext,
    Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Anything that looks like a caller-supplied user id. Deliberately loose: it is
 * meant to catch `userLoginId`, `userId`, `user_id` and whatever the next
 * variation is called.
 */
const USER_ID_LIKE = /user.*id/i;

/**
 * Refuses any request that tries to name the user it acts on.
 *
 * Handlers take the id from the access token (`@CurrentUser()`), so a
 * `userLoginId` in the path or query string can only be one of two things: a
 * caller probing for the old behaviour, or a new route that reintroduced the
 * parameter and skipped the token. Both should be loud.
 *
 * The guard this replaced compared a `:userLoginId` segment against the token
 * and let every other route through untouched, so a route that spelled the
 * parameter `:userId` was simply never checked. Rejecting the whole shape,
 * rather than reconciling one blessed spelling of it, removes that gap.
 *
 * Body fields are not checked here — guards run before validation, and the
 * global `ValidationPipe({ whitelist: true })` already strips any property no
 * DTO declares.
 */
@Injectable()
export class UserScopeGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        // Kafka handlers have no params, no query and no caller to distrust.
        if (context.getType() !== 'http') return true;

        const request = context.switchToHttp().getRequest<Request>();

        const offender =
            findUserIdLike(request.params) ?? findUserIdLike(request.query);

        if (offender) {
            throw new BadRequestException(
                `Requests cannot name a user: remove '${offender}'. ` +
                    'The user is taken from the access token.',
            );
        }

        return true;
    }
}

function findUserIdLike(source: unknown): string | undefined {
    if (!source || typeof source !== 'object') return undefined;
    return Object.keys(source).find((key) => USER_ID_LIKE.test(key));
}
