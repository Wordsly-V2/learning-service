import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from './authenticated-request';
import { ROLES_KEY } from './roles.decorator';

/**
 * Registered globally right after AccessGuard, so by the time it runs the token
 * has been verified and `request.user.roles` comes from a signed claim. A no-op
 * for any route without `@Roles(...)`.
 *
 * Roles are read from the token, never from a profile lookup: they reach a new
 * access token at the next refresh, so a grant or revocation lands within one
 * access-token lifetime.
 */
@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        if (context.getType() !== 'http') return true;

        const required = this.reflector.getAllAndOverride<string[] | undefined>(
            ROLES_KEY,
            [context.getHandler(), context.getClass()],
        );
        if (!required || required.length === 0) return true;

        const held = context.switchToHttp().getRequest<AuthenticatedRequest>()
            .user?.roles;
        if (held?.some((role) => required.includes(role))) return true;

        throw new ForbiddenException('Insufficient role');
    }
}
