import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opt a route out of the global access guard.
 *
 * The guard is global and deny-by-default, so anything reachable without a
 * token or the internal header has to say so explicitly here — which keeps the
 * unauthenticated surface greppable rather than implied by a missing decorator.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
