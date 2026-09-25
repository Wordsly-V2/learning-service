import { CURRICULUM_SERVICE_HTTP } from '@/http-clients/http-clients.module';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AxiosInstance } from 'axios';
import { callPeer } from './peer-call';

/**
 * Asks curriculum-service which Wordsly Path items exist and are published.
 *
 * Path items are public, so there is no ownership to check. The check that
 * matters is that the id names a real, published item: without it any uuid
 * would mint a card and pay out XP. Archived items fail it too, so an offline
 * answer for an item retired since is dropped rather than reviving its card.
 */
@Injectable()
export class CurriculumScopeService {
    private readonly logger = new Logger(CurriculumScopeService.name);

    constructor(
        @Inject(CURRICULUM_SERVICE_HTTP)
        private readonly curriculumHttp: AxiosInstance,
    ) {}

    /** The subset of `itemIds` that are published Path items. */
    async filterPublishedItemIds(itemIds: string[]): Promise<Set<string>> {
        const unique = [...new Set(itemIds)];
        if (unique.length === 0) return new Set();
        const { itemIds: published } = await callPeer<{ itemIds: string[] }>(
            this.logger,
            'curriculum-service',
            'filter published path items',
            () =>
                this.curriculumHttp.post('/path/items/filter-published', {
                    itemIds: unique,
                }),
        );
        return new Set(published);
    }
}
