import {
    createParamDecorator,
    ExecutionContext,
    UnauthorizedException,
} from '@nestjs/common';
import { AuthenticatedRequest } from './authenticated-request';

/**
 * The id of the user making the request, taken from their verified access token.
 *
 * This is the only way a handler learns who it is acting for. Routes used to
 * carry the id themselves (`users/:userLoginId/...`) and a guard checked the
 * segment against the token; the id was still read from the request, so every
 * new route was one forgotten check away from serving someone else's rows.
 * Reading it from the decoded token instead makes that class of mistake
 * unrepresentable — there is no id in the request to get wrong.
 *
 * AccessGuard runs first and is deny-by-default, so `user` is always set by the
 * time this runs. The throw is for the one case that could still reach here: a
 * `@Public()` route asking for an identity nobody established.
 */
export const CurrentUser = createParamDecorator(
    (_data: unknown, context: ExecutionContext): string => {
        const request = context
            .switchToHttp()
            .getRequest<AuthenticatedRequest>();

        const sub = request.user?.sub;
        if (!sub) {
            throw new UnauthorizedException('No authenticated user');
        }
        return sub;
    },
);
