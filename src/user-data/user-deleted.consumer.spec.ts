import { KafkaContext } from '@nestjs/microservices';
import { Prisma } from '@prisma/client';
import { UserDataService } from './user-data.service';
import { UserDeletedConsumer } from './user-deleted.consumer';
import { parseUserDeletedPayload } from './user-deleted.payload';

const USER = '0190a000-0000-7000-8000-000000000001';

describe('parseUserDeletedPayload', () => {
    it('accepts a uuid userLoginId', () => {
        expect(
            parseUserDeletedPayload({ userLoginId: USER, deletedAt: 'x' }),
        ).toBe(USER);
    });

    it.each([
        ['a missing field', {}],
        ['a non-uuid', { userLoginId: 'nope' }],
        ['a number', { userLoginId: 42 }],
        ['null', null],
        ['an unparsed string', `{"userLoginId":"${USER}"}`],
    ])('rejects %s', (_label, payload) => {
        expect(parseUserDeletedPayload(payload)).toBeNull();
    });
});

describe('UserDeletedConsumer', () => {
    const commitOffsets = jest.fn().mockResolvedValue(undefined);
    const context = {
        getMessage: () => ({ offset: '7', value: Buffer.from('{}') }),
        getConsumer: () => ({ commitOffsets }),
        getTopic: () => 'user_deleted',
        getPartition: () => 0,
    } as unknown as KafkaContext;

    let purgeUser: jest.Mock;
    let consumer: UserDeletedConsumer;

    beforeEach(() => {
        commitOffsets.mockClear();
        purgeUser = jest.fn().mockResolvedValue({ wordProgress: 3 });
        consumer = new UserDeletedConsumer({ purgeUser } as never);
    });

    it('purges the user and commits', async () => {
        await consumer.handleUserDeleted({ userLoginId: USER }, context);

        expect(purgeUser).toHaveBeenCalledWith(USER);
        expect(commitOffsets).toHaveBeenCalledWith([
            { topic: 'user_deleted', partition: 0, offset: '8' },
        ]);
    });

    it('commits a redelivery that finds nothing left', async () => {
        purgeUser.mockResolvedValue({ wordProgress: 0 });
        await consumer.handleUserDeleted({ userLoginId: USER }, context);
        await consumer.handleUserDeleted({ userLoginId: USER }, context);

        expect(purgeUser).toHaveBeenCalledTimes(2);
        expect(commitOffsets).toHaveBeenCalledTimes(2);
    });

    it('commits a malformed message without deleting anything', async () => {
        await consumer.handleUserDeleted({ userLoginId: '' }, context);

        expect(purgeUser).not.toHaveBeenCalled();
        expect(commitOffsets).toHaveBeenCalledTimes(1);
    });
});

describe('UserDataService.purgeUser', () => {
    it("deletes only that user's rows, in every table", async () => {
        const calls: string[] = [];
        const tx = new Proxy(
            {},
            {
                get: (_target, table: string) => ({
                    deleteMany: jest.fn((args: unknown) => {
                        expect(args).toEqual({ where: { userLoginId: USER } });
                        calls.push(table);
                        return Promise.resolve({ count: 1 });
                    }),
                }),
            },
        );
        const prisma = {
            $transaction: (run: (client: unknown) => unknown) => run(tx),
        };

        const purged = await new UserDataService(prisma as never).purgeUser(
            USER,
        );

        // Every model that holds a userLoginId, so a new table can't be missed.
        const userTables = Prisma.dmmf.datamodel.models
            .filter((model) =>
                model.fields.some((field) => field.name === 'userLoginId'),
            )
            .map((model) => model.name[0].toLowerCase() + model.name.slice(1));
        expect([...calls].sort()).toEqual([...userTables].sort());
        // A habit's days go before the habit (foreign key).
        expect(calls.indexOf('dailyHabitDay')).toBeLessThan(
            calls.indexOf('dailyHabit'),
        );
        expect(Object.values(purged).every((count) => count === 1)).toBe(true);
    });
});
