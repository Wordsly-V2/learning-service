jest.mock('uuid', () => ({ v7: () => '00000000-0000-7000-8000-000000000000' }));

import { NotFoundException } from '@nestjs/common';
import { AnswerQuality } from './dto/word-progress.dto';
import { WordProgressController } from './word-progress.controller';

describe('WordProgressController record-answer ownership', () => {
    const ownId = '0190a000-0000-7000-8000-000000000001';
    const foreignId = '0190a000-0000-7000-8000-000000000002';

    let wordProgressService: {
        recordAnswer: jest.Mock;
        recordAnswersBulk: jest.Mock;
    };
    let wordScopeService: { filterOwnedWordIds: jest.Mock };
    let controller: WordProgressController;

    beforeEach(() => {
        wordProgressService = {
            recordAnswer: jest.fn().mockResolvedValue({}),
            recordAnswersBulk: jest.fn().mockResolvedValue({ results: [] }),
        };
        wordScopeService = {
            filterOwnedWordIds: jest.fn().mockResolvedValue(new Set([ownId])),
        };
        controller = new WordProgressController(
            wordProgressService as never,
            wordScopeService as never,
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
});
