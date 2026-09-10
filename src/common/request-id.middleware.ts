import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { REQUEST_ID_HEADER, runWithRequestId } from './request-context';

/** Length cap on a client-supplied id, so it cannot bloat every log line. */
const MAX_ID_LENGTH = 128;
const SAFE_ID = /^[\w.:-]+$/;

/**
 * Put a request id in scope for the whole request.
 *
 * Reuses the inbound header when the gateway (or another hop) already set one,
 * so a single id follows a request across services and one failure can be
 * traced end to end. An id supplied by a client is untrusted text that ends up
 * in logs, so it is accepted only if it is short and boring — otherwise it is
 * replaced rather than rejected, since a bad id is no reason to fail a request.
 */
export function requestIdMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    const inbound = req.headers[REQUEST_ID_HEADER];
    const candidate = Array.isArray(inbound) ? inbound[0] : inbound;

    const requestId =
        candidate &&
        candidate.length <= MAX_ID_LENGTH &&
        SAFE_ID.test(candidate)
            ? candidate
            : randomUUID();

    req.headers[REQUEST_ID_HEADER] = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    runWithRequestId(requestId, next);
}
