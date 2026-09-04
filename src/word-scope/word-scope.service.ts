import { VOCABULARY_SERVICE_HTTP } from '@/http-clients/http-clients.module';
import {
    ForbiddenException,
    Inject,
    Injectable,
    InternalServerErrorException,
    Logger,
    ServiceUnavailableException,
    UnauthorizedException,
} from '@nestjs/common';
import type { AxiosInstance } from 'axios';

export interface WordScopeGroup {
    wordIds: string[];
}

/**
 * Resolves "which words are in this course/lesson" from vocabulary-service.
 *
 * Word ownership lives there; progress over those words lives here. The gateway
 * used to hold both halves and stitch them together, which is why it could not
 * become a plain proxy. Now the service that owns the response resolves the
 * scope itself.
 *
 * This is the one place learning-service depends on a peer at request time, so
 * failures are translated rather than leaked: a vocabulary outage is a 503, not
 * an opaque 500 or an empty result set. Returning empty would be worse than
 * failing — a practice session would silently look finished.
 *
 * None of these methods takes a user id. The request carries the caller's own
 * access token (see `http-clients/caller-context.ts`) and vocabulary-service
 * derives the user from it, so this service cannot ask about anyone but the
 * learner whose request it is serving — there is no argument through which it
 * could.
 */
@Injectable()
export class WordScopeService {
    private readonly logger = new Logger(WordScopeService.name);

    constructor(
        @Inject(VOCABULARY_SERVICE_HTTP)
        private readonly vocabularyHttp: AxiosInstance,
    ) {}

    /** Word ids in a course or lesson. Both filters absent means the whole library. */
    async getScopedWordIds(
        courseId?: string,
        lessonId?: string,
    ): Promise<string[]> {
        const { wordIds } = await this.call<{ wordIds: string[] }>(
            () =>
                this.vocabularyHttp.get('/words/scoped-ids', {
                    params: { courseId, lessonId },
                }),
            'resolve scoped word ids',
        );
        return wordIds;
    }

    async groupByCourseIds(
        courseIds: string[],
    ): Promise<Record<string, WordScopeGroup>> {
        if (courseIds.length === 0) return {};
        return this.call(
            () =>
                this.vocabularyHttp.post('/words/group-by-course-ids', {
                    courseIds,
                }),
            'group word ids by course',
        );
    }

    async groupByLessonIds(
        lessonIds: string[],
    ): Promise<Record<string, WordScopeGroup>> {
        if (lessonIds.length === 0) return {};
        return this.call(
            () =>
                this.vocabularyHttp.post('/words/group-by-lesson-ids', {
                    lessonIds,
                }),
            'group word ids by lesson',
        );
    }

    /**
     * Turn a list of ids into the `scopes` shape the stats endpoint takes,
     * preserving the caller's order and representing a scope with no words as an
     * empty list rather than dropping it.
     */
    toScopes(
        ids: string[],
        grouped: Record<string, WordScopeGroup>,
    ): { scopeId: string; wordIds: string[] }[] {
        return ids.map((scopeId) => ({
            scopeId,
            wordIds: grouped[scopeId]?.wordIds ?? [],
        }));
    }

    private async call<T>(
        request: () => Promise<{ data: T }>,
        what: string,
    ): Promise<T> {
        try {
            const { data } = await request();
            return data;
        } catch (error) {
            const status = (error as { response?: { status?: number } })
                ?.response?.status;

            this.logger.error(
                `Failed to ${what} via vocabulary-service (status=${status ?? 'none'})`,
            );

            // No response at all, or the peer itself is unavailable: the work
            // could not be done, and saying so beats returning a plausible-
            // looking empty scope that reads as "nothing left to practise".
            if (!status || status >= 500) {
                throw new ServiceUnavailableException(
                    'Word scopes are temporarily unavailable',
                );
            }

            // The peer rejected the forwarded token. Report that as itself
            // rather than as a 500: an expired token mid-session is an ordinary
            // thing the client knows how to recover from by refreshing, and
            // burying it in a server error would make it look like our bug.
            if (status === 401) {
                throw new UnauthorizedException(
                    'Access token was rejected by vocabulary-service',
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
}
