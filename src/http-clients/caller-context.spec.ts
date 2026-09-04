import {
    getCallerAuthorization,
    MissingCallerCredentialError,
    runWithCaller,
} from '@/http-clients/caller-context';

describe('caller context', () => {
    it('exposes the caller credential to everything the request awaits', async () => {
        const seen = await runWithCaller('Bearer abc', async () => {
            await Promise.resolve();
            return getCallerAuthorization();
        });
        expect(seen).toBe('Bearer abc');
    });

    it('does not leak the credential outside the request', async () => {
        await runWithCaller('Bearer abc', () => Promise.resolve());
        expect(getCallerAuthorization()).toBeUndefined();
    });

    it('keeps concurrent requests apart', async () => {
        const [a, b] = await Promise.all([
            runWithCaller('Bearer a', async () => {
                await new Promise((r) => setTimeout(r, 10));
                return getCallerAuthorization();
            }),
            runWithCaller('Bearer b', () =>
                Promise.resolve(getCallerAuthorization()),
            ),
        ]);
        expect([a, b]).toEqual(['Bearer a', 'Bearer b']);
    });

    it('reports an unauthenticated request as having no credential', () => {
        expect(
            runWithCaller(undefined, getCallerAuthorization),
        ).toBeUndefined();
    });

    it('has an error to throw when there is nothing to forward', () => {
        // The point of the type: a peer call outside a request must fail rather
        // than fall back to a credential that can act for anyone.
        expect(new MissingCallerCredentialError()).toBeInstanceOf(Error);
    });
});
