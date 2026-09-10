import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestStore {
    /** Correlates every log line for one request, across service hops. */
    requestId: string;
}

const storage = new AsyncLocalStorage<RequestStore>();

/** Header the gateway sets and every service propagates. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Deliberately separate from any store holding a credential.
 *
 * A request id is for logging and may be echoed to the client; an inbound
 * `Authorization` header must not be. Keeping them in different stores means a
 * future change to logging cannot widen the reach of the credential store by
 * accident.
 */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
    return storage.run({ requestId }, fn);
}

/** The current request's id, or undefined outside a request (cron, consumers). */
export function getRequestId(): string | undefined {
    return storage.getStore()?.requestId;
}
