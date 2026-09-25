import { ItemSource } from '@prisma/client';

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
