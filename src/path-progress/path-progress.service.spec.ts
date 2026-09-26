import { PathProgressService } from './path-progress.service';

describe('PathProgressService.apply', () => {
    const USER = '0190a000-0000-7000-8000-000000000001';

    it('stores the totals and unlocks the Path badges they reach', async () => {
        const tx = { $executeRaw: jest.fn().mockResolvedValue(1) };
        const prisma = {
            $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
        };
        const achievements = {
            detectAndUnlock: jest.fn().mockResolvedValue([]),
        };
        const service = new PathProgressService(
            prisma as never,
            achievements as never,
        );

        await service.apply({
            userLoginId: USER,
            lessonsCompleted: 10,
            unitsCompleted: 1,
            stagesCompleted: 0,
            occurredAt: new Date('2026-09-26T10:00:00Z'),
        });

        expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
        const [[, user, badges]] = achievements.detectAndUnlock.mock.calls as [
            [unknown, string, { key: string; achieved: boolean }[]],
        ];
        expect(user).toBe(USER);
        expect(badges.filter((b) => b.achieved).map((b) => b.key)).toEqual([
            'lessons-1',
            'lessons-10',
            'units-1',
        ]);
    });
});
