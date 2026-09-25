import { Injectable } from '@nestjs/common';
import { CurriculumScopeService } from './curriculum-scope.service';
import { type ItemSourceParam } from './item-source';
import { WordScopeService } from './word-scope.service';

export interface SourcedItem {
    id: string;
    source?: ItemSourceParam;
}

/**
 * Which of these ids may the caller get a card for?
 *
 * A vocab id must be a word the learner owns (vocabulary-service); a path id
 * must be a published Wordsly Path item (curriculum-service). A batch can mix
 * both, since the offline queue flushes whatever it holds in one request, so
 * the two lookups run in parallel and their answers are merged.
 */
@Injectable()
export class ItemScopeService {
    constructor(
        private readonly wordScope: WordScopeService,
        private readonly curriculumScope: CurriculumScopeService,
    ) {}

    async filterAccessible(items: SourcedItem[]): Promise<Set<string>> {
        const vocabIds: string[] = [];
        const pathIds: string[] = [];
        for (const item of items) {
            (item.source === 'path' ? pathIds : vocabIds).push(item.id);
        }

        const [ownedWords, publishedItems] = await Promise.all([
            this.wordScope.filterOwnedWordIds(vocabIds),
            this.curriculumScope.filterPublishedItemIds(pathIds),
        ]);
        return new Set([...ownedWords, ...publishedItems]);
    }
}
