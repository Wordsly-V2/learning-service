jest.mock('uuid', () => ({ v7: () => '00000000-0000-7000-8000-000000000000' }));

import { KafkaContext } from '@nestjs/microservices';
import {
    parseWordDeletedPayload,
    WordProgressConsumer,
} from './word-progress.consumer';

describe('WordProgressConsumer', () => {
    const id = '0190a000-0000-7000-8000-000000000001';

    describe('parseWordDeletedPayload', () => {
        it('accepts a non-empty uuid array', () => {
            expect(parseWordDeletedPayload({ wordIds: [id] })).toEqual([id]);
        });

        it.each([
            ['a missing wordIds field', {}],
            ['the legacy single-word shape', { wordId: id }],
            ['an unparsed string', `{"wordIds":["${id}"]}`],
            ['null', null],
            ['an empty array', { wordIds: [] }],
            ['a non-uuid entry', { wordIds: [id, 'nope'] }],
            ['a non-string entry', { wordIds: [42] }],
        ])('rejects %s', (_label, payload) => {
            expect(parseWordDeletedPayload(payload)).toBeNull();
        });
    });

    describe('handleWordDeleted', () => {
        const commitOffsets = jest.fn().mockResolvedValue(undefined);
        const context = {
            getMessage: () => ({ offset: '7', value: Buffer.from('{}') }),
            getConsumer: () => ({ commitOffsets }),
            getTopic: () => 'words_deleted',
            getPartition: () => 0,
        } as unknown as KafkaContext;

        let wordProgressService: { deleteProgressForWords: jest.Mock };
        let savedWordService: { deleteForWords: jest.Mock };
        let consumer: WordProgressConsumer;

        beforeEach(() => {
            commitOffsets.mockClear();
            wordProgressService = {
                deleteProgressForWords: jest.fn().mockResolvedValue(undefined),
            };
            savedWordService = {
                deleteForWords: jest.fn().mockResolvedValue(undefined),
            };
            consumer = new WordProgressConsumer(
                wordProgressService as never,
                savedWordService as never,
            );
        });

        it('commits a malformed message without deleting anything', async () => {
            await consumer.handleWordDeleted({}, context);

            expect(
                wordProgressService.deleteProgressForWords,
            ).not.toHaveBeenCalled();
            expect(savedWordService.deleteForWords).not.toHaveBeenCalled();
            expect(commitOffsets).toHaveBeenCalledWith([
                { topic: 'words_deleted', partition: 0, offset: '8' },
            ]);
        });

        it('deletes progress and saved words for a valid message', async () => {
            await consumer.handleWordDeleted({ wordIds: [id] }, context);

            expect(
                wordProgressService.deleteProgressForWords,
            ).toHaveBeenCalledWith([id]);
            expect(savedWordService.deleteForWords).toHaveBeenCalledWith([id]);
            expect(commitOffsets).toHaveBeenCalledTimes(1);
        });
    });
});
