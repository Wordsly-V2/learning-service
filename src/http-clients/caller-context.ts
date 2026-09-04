import { AsyncLocalStorage } from 'node:async_hooks';

interface CallerStore {
    /** The inbound `Authorization` header, verbatim, or undefined if there was none. */
    authorization?: string;
}

const storage = new AsyncLocalStorage<CallerStore>();

/**
 * Thrown when a peer call is attempted with no caller to speak for.
 *
 * There is deliberately no fallback. This service holds no credential of its
 * own that vocabulary-service would accept — that was the point of removing the
 * shared internal token, which satisfied every guard for every user and made a
 * single leaked value enough to read anyone's data. Work that happens outside a
 * request (cron jobs, Kafka consumers) has no caller, so it must run against
 * this service's own database rather than reaching across the mesh. All of it
 * already does; this error exists so that stops being true loudly.
 */
export class MissingCallerCredentialError extends Error {
    constructor() {
        super(
            'No caller credential in scope: peer calls may only be made while ' +
                'serving an authenticated request.',
        );
        this.name = 'MissingCallerCredentialError';
    }
}

/** Run `fn` with the caller's credential available to anything it awaits. */
export function runWithCaller<T>(
    authorization: string | undefined,
    fn: () => T,
): T {
    return storage.run({ authorization }, fn);
}

/** The current caller's `Authorization` header, if we are inside a request. */
export function getCallerAuthorization(): string | undefined {
    return storage.getStore()?.authorization;
}
