import { KafkaContext } from '@nestjs/microservices';
import { PathProgressConsumer } from './path-progress.consumer';

describe('PathProgressConsumer', () => {
    const commitOffsets = jest.fn().mockResolvedValue(undefined);
    const context = {
        getMessage: () => ({ offset: '3', value: Buffer.from('{}') }),
        getConsumer: () => ({ commitOffsets }),
        getTopic: () => 'path_progress',
        getPartition: () => 0,
    } as unknown as KafkaContext;

    let apply: jest.Mock;
    let consumer: PathProgressConsumer;

    beforeEach(() => {
        commitOffsets.mockClear();
        apply = jest.fn().mockResolvedValue([]);
        consumer = new PathProgressConsumer({ apply } as never);
    });

    it('applies a valid event and commits', async () => {
        await consumer.handlePathProgress(
            {
                userLoginId: '0190a000-0000-7000-8000-000000000001',
                lessonsCompleted: 1,
                unitsCompleted: 0,
                stagesCompleted: 0,
                occurredAt: '2026-09-26T10:00:00.000Z',
            },
            context,
        );
        expect(apply).toHaveBeenCalledTimes(1);
        expect(commitOffsets).toHaveBeenCalledWith([
            { topic: 'path_progress', partition: 0, offset: '4' },
        ]);
    });

    it('commits a malformed message without applying it', async () => {
        await consumer.handlePathProgress({ userLoginId: 'x' }, context);
        expect(apply).not.toHaveBeenCalled();
        expect(commitOffsets).toHaveBeenCalledTimes(1);
    });
});
