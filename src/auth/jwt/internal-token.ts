import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time comparison of the shared internal service token.
 *
 * `!==` on a secret leaks its prefix through timing. The length check before it
 * is unavoidable (timingSafeEqual throws on differing lengths) and leaks only
 * the token's length, which is not secret.
 */
export function isValidInternalToken(
    presented: string | undefined,
    expected: string | undefined,
): boolean {
    if (!presented || !expected) return false;

    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;

    return timingSafeEqual(a, b);
}
