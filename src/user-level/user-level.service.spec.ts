import { UserLevelService } from './user-level.service';

describe('UserLevelService', () => {
    const userLoginId = '01936c1e-1234-7890-abcd-ef1234567890';

    let prisma: {
        userLevel: {
            findUnique: jest.Mock;
            upsert: jest.Mock;
        };
    };
    let service: UserLevelService;

    beforeEach(() => {
        prisma = {
            userLevel: {
                findUnique: jest.fn(),
                upsert: jest.fn(),
            },
        };
        service = new UserLevelService(prisma as never);
    });

    describe('getUserLevel', () => {
        it('defaults to level 1 / 0 XP when no row exists', async () => {
            prisma.userLevel.findUnique.mockResolvedValue(null);

            const result = await service.getUserLevel(userLoginId);

            expect(result.level).toBe(1);
            expect(result.totalXp).toBe(0);
            expect(result.rank).toBe('Novice');
        });

        it('derives the snapshot from the stored XP', async () => {
            prisma.userLevel.findUnique.mockResolvedValue({
                userLoginId,
                totalXp: 150,
                level: 2,
            });

            const result = await service.getUserLevel(userLoginId);

            expect(result.level).toBe(2);
            expect(result.currentLevelXp).toBe(50);
            expect(result.progress).toBe(25);
        });
    });

    describe('awardXp', () => {
        it('increments XP and persists the recomputed level', async () => {
            prisma.userLevel.findUnique.mockResolvedValue({
                userLoginId,
                totalXp: 80,
                level: 1,
            });

            const event = await service.awardXp(prisma as never, userLoginId, 30);

            expect(prisma.userLevel.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { userLoginId },
                    update: { totalXp: { increment: 30 }, level: 2 },
                    create: { userLoginId, totalXp: 110, level: 2 },
                }),
            );
            expect(event.xpEarned).toBe(30);
            expect(event.leveledUp).toBe(true);
            expect(event.previousLevel).toBe(1);
            expect(event.level).toBe(2);
        });

        it('reports no level-up when staying within a level', async () => {
            prisma.userLevel.findUnique.mockResolvedValue({
                userLoginId,
                totalXp: 120,
                level: 2,
            });

            const event = await service.awardXp(prisma as never, userLoginId, 10);

            expect(event.leveledUp).toBe(false);
            expect(event.level).toBe(2);
            expect(event.previousLevel).toBe(2);
        });

        it('creates the row for a brand-new user', async () => {
            prisma.userLevel.findUnique.mockResolvedValue(null);

            const event = await service.awardXp(prisma as never, userLoginId, 25);

            expect(prisma.userLevel.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    create: { userLoginId, totalXp: 25, level: 1 },
                }),
            );
            expect(event.totalXp).toBe(25);
            expect(event.leveledUp).toBe(false);
        });

        it('no-ops (no write) when the amount is zero or negative', async () => {
            prisma.userLevel.findUnique.mockResolvedValue({
                userLoginId,
                totalXp: 200,
                level: 2,
            });

            const event = await service.awardXp(prisma as never, userLoginId, 0);

            expect(prisma.userLevel.upsert).not.toHaveBeenCalled();
            expect(event.xpEarned).toBe(0);
            expect(event.leveledUp).toBe(false);
            expect(event.totalXp).toBe(200);
        });
    });
});
