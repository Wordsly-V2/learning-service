import type { Request } from 'express';

/** Identity the access guard attaches once a token has been verified. */
export interface AuthenticatedUser {
    /** The `UserLogin` id — the token's subject, and what rows are scoped by. */
    sub: string;
    /** Session id, shared with the refresh token of the same login. */
    sid: string;
    /** This access token's own id. */
    jti: string;
}

export interface AuthenticatedRequest extends Request {
    user?: AuthenticatedUser;
    /**
     * True when the caller presented the internal service token, i.e. it is a
     * peer service inside the mesh rather than a browser. Such calls carry no
     * end-user identity, so per-user ownership checks do not apply to them.
     */
    isInternalCall?: boolean;
}
