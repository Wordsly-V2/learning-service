import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/** The role behind every `/admin/*` route. */
export const ADMIN_ROLE = 'admin';

/**
 * Require the caller's access token to carry at least one of these roles.
 * Enforced by the global RolesGuard; a route without it is open to any
 * authenticated user, exactly as before roles existed.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
