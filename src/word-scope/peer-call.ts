import {
    ForbiddenException,
    InternalServerErrorException,
    Logger,
    ServiceUnavailableException,
    UnauthorizedException,
} from '@nestjs/common';

/**
 * Run a peer request and translate its failure into what the caller should see.
 *
 * Scope lookups are the only places learning-service depends on a peer at
 * request time, so failures are translated rather than leaked: a peer outage is
 * a 503, not an opaque 500 or an empty result set. Returning empty would be
 * worse than failing, since a practice session would silently look finished.
 */
export async function callPeer<T>(
    logger: Logger,
    peer: string,
    what: string,
    request: () => Promise<{ data: T }>,
): Promise<T> {
    try {
        const { data } = await request();
        return data;
    } catch (error) {
        const status = (error as { response?: { status?: number } })?.response
            ?.status;

        logger.error(
            `Failed to ${what} via ${peer} (status=${status ?? 'none'})`,
        );

        // No response at all, or the peer itself is unavailable: the work
        // could not be done, and saying so beats returning a plausible-looking
        // empty scope that reads as "nothing left to practise".
        if (!status || status >= 500) {
            throw new ServiceUnavailableException(
                'Word scopes are temporarily unavailable',
            );
        }

        // The peer rejected the forwarded token. Report that as itself rather
        // than as a 500: an expired token mid-session is an ordinary thing the
        // client knows how to recover from by refreshing, and burying it in a
        // server error would make it look like our bug.
        if (status === 401) {
            throw new UnauthorizedException(
                `Access token was rejected by ${peer}`,
            );
        }
        if (status === 403) {
            throw new ForbiddenException(
                'Not allowed to read these word scopes',
            );
        }

        throw new InternalServerErrorException(`Failed to ${what}`);
    }
}
