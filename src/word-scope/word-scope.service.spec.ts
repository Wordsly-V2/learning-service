import {
    ForbiddenException,
    InternalServerErrorException,
    ServiceUnavailableException,
    UnauthorizedException,
} from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { AxiosInstance } from 'axios';
import { WordScopeService } from '@/word-scope/word-scope.service';

/**
 * How a peer failure is reported matters more than it looks: returning an empty
 * scope would make a practice session silently look finished, and reporting a
 * rejected token as a 500 would make the client's own refresh-and-retry path
 * look like a server bug.
 */
describe('WordScopeService', () => {
    const httpWith = (impl: () => Promise<unknown>) =>
        ({ get: impl, post: impl }) as unknown as AxiosInstance;

    /** Axios rejects with an Error carrying `response`, or without one on a timeout. */
    const failWith = (status?: number) => () => {
        const error = Object.assign(
            new Error(`peer failed (${status ?? 'no response'})`),
            status ? { response: { status } } : {},
        );
        return Promise.reject(error);
    };

    beforeAll(() => {
        // The service logs every failure by design; keep the suite readable.
        jest.spyOn(Logger.prototype, 'error').mockImplementation(
            () => undefined,
        );
    });

    it('asks for the scope without naming a user', async () => {
        const get = jest.fn().mockResolvedValue({ data: { wordIds: ['w1'] } });
        const service = new WordScopeService({
            get,
        } as unknown as AxiosInstance);

        await expect(service.getScopedWordIds('course-1')).resolves.toEqual([
            'w1',
        ]);

        const [url, config] = get.mock.calls[0] as [
            string,
            { params: Record<string, unknown> },
        ];
        expect(url).toBe('/words/scoped-ids');
        expect(url).not.toContain('users');
        expect(config.params).toEqual({
            courseId: 'course-1',
            lessonId: undefined,
        });
    });

    it.each([
        ['a rejected token', 401, UnauthorizedException],
        ['a refused scope', 403, ForbiddenException],
    ])(
        'reports %s as itself, not as a server error',
        async (_l, status, expected) => {
            const service = new WordScopeService(httpWith(failWith(status)));
            await expect(service.getScopedWordIds()).rejects.toBeInstanceOf(
                expected,
            );
        },
    );

    it('reports a peer outage as unavailable rather than empty', async () => {
        const service = new WordScopeService(httpWith(failWith(503)));
        await expect(service.getScopedWordIds()).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
    });

    it('treats no response at all as an outage', async () => {
        const service = new WordScopeService(httpWith(failWith()));
        await expect(service.getScopedWordIds()).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
    });

    it('still reports other client errors as a server-side failure', async () => {
        const service = new WordScopeService(httpWith(failWith(404)));
        await expect(service.getScopedWordIds()).rejects.toBeInstanceOf(
            InternalServerErrorException,
        );
    });

    it('makes no call at all for an empty id list', async () => {
        const post = jest.fn();
        const service = new WordScopeService({
            post,
        } as unknown as AxiosInstance);

        await expect(service.groupByCourseIds([])).resolves.toEqual({});
        expect(post).not.toHaveBeenCalled();
    });
});
