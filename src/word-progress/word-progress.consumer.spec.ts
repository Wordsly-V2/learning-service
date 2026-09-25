jest.mock('uuid', () => ({ v7: () => '00000000-0000-7000-8000-000000000000' }));

import { KafkaContext } from '@nestjs/microservices';
import {
    parsePathItemsRetiredPayload,
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

    describe('handlePathItemsRetired', () => {
        const commitOffsets = jest.fn().mockResolvedValue(undefined);
        const context = {
            getMessage: () => ({ offset: '3', value: Buffer.from('{}') }),
            getConsumer: () => ({ commitOffsets }),
            getTopic: () => 'path_items_retired',
            getPartition: () => 0,
        } as unknown as KafkaContext;
        let deletePathProgressForItems: jest.Mock;
        let consumer: WordProgressConsumer;

        beforeEach(() => {
            commitOffsets.mockClear();
            deletePathProgressForItems = jest.fn().mockResolvedValue(undefined);
            consumer = new WordProgressConsumer(
                { deletePathProgressForItems } as never,
                { deleteForWords: jest.fn() } as never,
            );
        });

        it('parses only a non-empty uuid list under itemIds', () => {
            expect(parsePathItemsRetiredPayload({ itemIds: [id] })).toEqual([
                id,
            ]);
            expect(parsePathItemsRetiredPayload({ wordIds: [id] })).toBeNull();
            expect(parsePathItemsRetiredPayload({ itemIds: [] })).toBeNull();
            expect(parsePathItemsRetiredPayload({ itemIds: ['x'] })).toBeNull();
        });

        it('drops Path progress for the items, then commits', async () => {
            await consumer.handlePathItemsRetired({ itemIds: [id] }, context);
            expect(deletePathProgressForItems).toHaveBeenCalledWith([id]);
            expect(commitOffsets).toHaveBeenCalledWith([
                { topic: 'path_items_retired', partition: 0, offset: '4' },
            ]);
        });

        it('commits a malformed message without deleting anything', async () => {
            await consumer.handlePathItemsRetired({ itemIds: 'all' }, context);
            expect(deletePathProgressForItems).not.toHaveBeenCalled();
            expect(commitOffsets).toHaveBeenCalled();
        });
    });
});
