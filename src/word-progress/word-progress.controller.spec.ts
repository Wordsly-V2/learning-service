jest.mock('uuid', () => ({ v7: () => '00000000-0000-7000-8000-000000000000' }));

import { NotFoundException } from '@nestjs/common';
import { ItemSource } from '@prisma/client';
import { ItemScopeService } from '@/word-scope/item-scope.service';
import { AnswerQuality } from './dto/word-progress.dto';
import { WordProgressController } from './word-progress.controller';

describe('WordProgressController record-answer ownership', () => {
    const ownId = '0190a000-0000-7000-8000-000000000001';
    const foreignId = '0190a000-0000-7000-8000-000000000002';
    // Path item ids are uuidv5 (derived from the item's slug).
    const publishedItemId = '5d3a1b7e-2c4f-5a8b-9c0d-1e2f3a4b5c6d';
    const archivedItemId = '5d3a1b7e-2c4f-5a8b-9c0d-1e2f3a4b5c6e';

    let wordProgressService: {
        recordAnswer: jest.Mock;
        recordAnswersBulk: jest.Mock;
        getDueWordIds: jest.Mock;
        getCardIdsBySource: jest.Mock;
    };
    let wordScopeService: {
        filterOwnedWordIds: jest.Mock;
        getScopedWordIds: jest.Mock;
    };
    let curriculumScopeService: { filterPublishedItemIds: jest.Mock };
    let controller: WordProgressController;

    beforeEach(() => {
        wordProgressService = {
            recordAnswer: jest.fn().mockResolvedValue({}),
            recordAnswersBulk: jest.fn().mockResolvedValue({ results: [] }),
            getDueWordIds: jest.fn().mockResolvedValue({ wordIds: [] }),
            getCardIdsBySource: jest.fn().mockResolvedValue([]),
        };
        // Each peer answers only for the ids it owns, like the real services.
        wordScopeService = {
            filterOwnedWordIds: jest.fn((ids: string[]) =>
                Promise.resolve(new Set(ids.filter((id) => id === ownId))),
            ),
            getScopedWordIds: jest.fn().mockResolvedValue([ownId]),
        };
        curriculumScopeService = {
            filterPublishedItemIds: jest.fn((ids: string[]) =>
                Promise.resolve(
                    new Set(ids.filter((id) => id === publishedItemId)),
                ),
            ),
        };
        controller = new WordProgressController(
            wordProgressService as never,
            wordScopeService as never,
            new ItemScopeService(
                wordScopeService as never,
                curriculumScopeService as never,
            ),
        );
    });

    it('rejects a single answer for a word the caller does not own', async () => {
        await expect(
            controller.recordAnswer('user-a', {
                wordId: foreignId,
                quality: AnswerQuality.PERFECT,
            }),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(wordProgressService.recordAnswer).not.toHaveBeenCalled();
    });

    it('records a single answer for an owned word', async () => {
        await controller.recordAnswer('user-a', {
            wordId: ownId,
            quality: AnswerQuality.PERFECT,
        });
        expect(wordProgressService.recordAnswer).toHaveBeenCalledWith(
            expect.objectContaining({ wordId: ownId, userLoginId: 'user-a' }),
        );
    });

    it('drops unowned answers from a bulk sync and keeps the rest', async () => {
        await controller.recordAnswersBulkSync('user-a', {
            answers: [
                { wordId: ownId, quality: AnswerQuality.PERFECT },
                { wordId: foreignId, quality: AnswerQuality.PERFECT },
            ],
        } as never);

        expect(wordProgressService.recordAnswersBulk).toHaveBeenCalledWith(
            'user-a',
            expect.objectContaining({
                answers: [expect.objectContaining({ wordId: ownId })],
            }),
        );
    });

    describe('Wordsly Path items', () => {
        it('records an answer for a published Path item, checked against curriculum-service', async () => {
            await controller.recordAnswer('user-a', {
                wordId: publishedItemId,
                quality: AnswerQuality.PERFECT,
                source: 'path',
            });

            expect(
                curriculumScopeService.filterPublishedItemIds,
            ).toHaveBeenCalledWith([publishedItemId]);
            expect(wordProgressService.recordAnswer).toHaveBeenCalledWith(
                expect.objectContaining({
                    wordId: publishedItemId,
                    source: 'path',
                }),
            );
        });

        it('does not accept a Path item id sent without source=path', async () => {
            // Treated as a vocabulary word, which the learner does not own.
            await expect(
                controller.recordAnswer('user-a', {
                    wordId: publishedItemId,
                    quality: AnswerQuality.PERFECT,
                }),
            ).rejects.toBeInstanceOf(NotFoundException);
        });

        it('keeps vocab and published Path answers from one mixed offline flush, dropping the rest', async () => {
            await controller.recordAnswersBulkSync('user-a', {
                answers: [
                    { wordId: ownId, quality: AnswerQuality.PERFECT },
                    {
                        wordId: publishedItemId,
                        quality: AnswerQuality.PERFECT,
                        source: 'path',
                    },
                    {
                        wordId: archivedItemId,
                        quality: AnswerQuality.PERFECT,
                        source: 'path',
                    },
                    { wordId: foreignId, quality: AnswerQuality.PERFECT },
                ],
            } as never);

            // Each id is asked of the service that owns it, and only once.
            expect(wordScopeService.filterOwnedWordIds).toHaveBeenCalledWith([
                ownId,
                foreignId,
            ]);
            expect(
                curriculumScopeService.filterPublishedItemIds,
            ).toHaveBeenCalledWith([publishedItemId, archivedItemId]);
            const [, forwarded] = wordProgressService.recordAnswersBulk.mock
                .calls[0] as [string, { answers: { wordId: string }[] }];
            expect(forwarded.answers.map((a) => a.wordId)).toEqual([
                ownId,
                publishedItemId,
            ]);
        });

        it('scopes the Path review by source instead of resolving an id list', async () => {
            await controller.getDueWordIds('user-a', { source: 'path' });

            expect(wordProgressService.getDueWordIds).toHaveBeenCalledWith(
                'user-a',
                expect.objectContaining({ wordIds: [] }),
                ItemSource.PATH,
            );
            expect(wordScopeService.getScopedWordIds).not.toHaveBeenCalled();
        });

        it('still resolves a vocab scope from vocabulary-service', async () => {
            await controller.getDueWordIds('user-a', { courseId: 'course-1' });

            expect(wordScopeService.getScopedWordIds).toHaveBeenCalledWith(
                'course-1',
                undefined,
            );
            expect(wordProgressService.getDueWordIds).toHaveBeenCalledWith(
                'user-a',
                expect.objectContaining({ wordIds: [ownId] }),
            );
        });
    });
});
