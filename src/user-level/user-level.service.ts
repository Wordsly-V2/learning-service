import { PrismaService } from '@/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { computeLevelProgress, levelFromXp } from './user-level.logic';
import { LevelEventDto, UserLevelResponseDto } from './dto/user-level.dto';

@Injectable()
export class UserLevelService {
    constructor(private readonly prisma: PrismaService) {}

    /** Current level snapshot (defaults to level 1 / 0 XP when the user has no row). */
    async getUserLevel(userLoginId: string): Promise<UserLevelResponseDto> {
        const row = await this.prisma.userLevel.findUnique({
            where: { userLoginId },
        });
        return computeLevelProgress(row?.totalXp ?? 0);
    }

    /**
     * Add XP to a user inside an existing transaction. The increment is DB-side
     * (lossless under concurrency) and `level` is recomputed from the in-tx read.
     * Returns the new snapshot plus whether a level boundary was crossed.
     *
     * No-ops (returns the current snapshot) when amount <= 0 so callers can call
     * unconditionally.
     */
    async awardXp(
        tx: Prisma.TransactionClient,
        userLoginId: string,
        amount: number,
    ): Promise<LevelEventDto> {
        const before = await tx.userLevel.findUnique({
            where: { userLoginId },
        });
        const previousLevel = before?.level ?? 1;
        const previousXp = before?.totalXp ?? 0;

        if (amount <= 0) {
            return {
                ...computeLevelProgress(previousXp),
                xpEarned: 0,
                leveledUp: false,
                previousLevel,
            };
        }

        const newTotal = previousXp + amount;
        const newLevel = levelFromXp(newTotal);
        await tx.userLevel.upsert({
            where: { userLoginId },
            create: { userLoginId, totalXp: newTotal, level: newLevel },
            update: { totalXp: { increment: amount }, level: newLevel },
        });

        return {
            ...computeLevelProgress(newTotal),
            xpEarned: amount,
            leveledUp: newLevel > previousLevel,
            previousLevel,
        };
    }
}
