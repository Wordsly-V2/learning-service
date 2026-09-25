/**
 * Where a card's item lives, as stored in `WordProgress.source` (a TEXT column;
 * no database enums). VOCAB: a word in the learner's own vocabulary-service
 * library. PATH: a Wordsly Path item in curriculum-service (uuidv5 ids, so the
 * two id spaces never collide).
 */
export const ItemSource = { VOCAB: 'VOCAB', PATH: 'PATH' } as const;
export type ItemSource = (typeof ItemSource)[keyof typeof ItemSource];

/**
 * Where an answered item lives, as the API spells it. Optional everywhere and
 * defaulting to `vocab`, so answers queued offline by clients that predate
 * Wordsly Path still mean what they meant.
 */
export const ITEM_SOURCE_PARAMS = ['vocab', 'path'] as const;
export type ItemSourceParam = (typeof ITEM_SOURCE_PARAMS)[number];

export function toItemSource(param: ItemSourceParam | undefined): ItemSource {
    return param === 'path' ? ItemSource.PATH : ItemSource.VOCAB;
}
