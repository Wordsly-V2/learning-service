import { VOCABULARY_SERVICE_HTTP } from '@/http-clients/http-clients.module';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AxiosInstance } from 'axios';
import { callPeer } from './peer-call';

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
 * Failures are translated by `callPeer`: a vocabulary outage is a 503, never an
 * empty scope.
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

    /**
     * The subset of `wordIds` the caller owns. Order and duplicates are not
     * preserved; callers filter their own list against the returned set.
     */
    async filterOwnedWordIds(wordIds: string[]): Promise<Set<string>> {
        const unique = [...new Set(wordIds)];
        if (unique.length === 0) return new Set();
        const { wordIds: owned } = await this.call<{ wordIds: string[] }>(
            () =>
                this.vocabularyHttp.post('/words/filter-owned', {
                    wordIds: unique,
                }),
            'filter owned word ids',
        );
        return new Set(owned);
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

    private call<T>(
        request: () => Promise<{ data: T }>,
        what: string,
    ): Promise<T> {
        return callPeer(this.logger, 'vocabulary-service', what, request);
    }
}
