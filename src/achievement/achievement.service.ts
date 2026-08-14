import { PrismaService } from '@/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
    Achievement,
    AchievementInput,
    computeAchievements,
} from '@/learning-report/learning-report.logic';
import { MAX_STREAK_FREEZES } from '@/daily-habit/daily-habit.logic';
import { UserLevelService } from '@/user-level/user-level.service';
import { achievementReward, diffNewlyUnlocked } from './achievement.logic';
import { UnlockedAchievementDto } from './dto/achievement.dto';

function isUniqueViolation(error: unknown): boolean {
    return (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
    );
}

@Injectable()
export class AchievementService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userLevelService: UserLevelService,
    ) {}

    /**
     * Detect achievements newly satisfied by the user's totals and persist them,
     * awarding XP and (for streak achievements) a capped streak freeze. Runs
     * inside the caller's transaction so unlocks are atomic with the write that
     * triggered them. Achievement XP is flat (no streak multiplier).
     */
    async detectAndUnlock(
        tx: Prisma.TransactionClient,
        userLoginId: string,
        input: AchievementInput,
    ): Promise<UnlockedAchievementDto[]> {
        const existing = await tx.userAchievement.findMany({
            where: { userLoginId },
            select: { key: true },
        });
        const existingKeys = new Set(existing.map((row) => row.key));
        const newKeys = diffNewlyUnlocked(input, existingKeys);
        if (newKeys.length === 0) {
            return [];
        }

        const byKey = new Map<string, Achievement>(
            computeAchievements(input).map((a) => [a.key, a]),
        );

        const unlocked: UnlockedAchievementDto[] = [];
        let totalXp = 0;
        let freezesToAdd = 0;
        const now = new Date();

        // Insert per key rather than in one createMany + skipDuplicates: two
        // concurrent writes (an online session and an offline flush landing
        // together) can both compute the same newKeys, and skipDuplicates would
        // silently drop one row while both still paid its XP. A failed insert
        // here means someone else already unlocked it, so we skip the reward.
        for (const key of newKeys) {
            const meta = byKey.get(key);
            if (!meta) continue;
            const reward = achievementReward(key);

            try {
                await tx.userAchievement.create({
                    data: {
                        userLoginId,
                        key,
                        unlockedAt: now,
                        xpAwarded: reward.xp,
                    },
                });
            } catch (error) {
                if (isUniqueViolation(error)) {
                    continue;
                }
                throw error;
            }

            totalXp += reward.xp;
            if (reward.streakFreeze) {
                freezesToAdd += 1;
            }
            unlocked.push({
                key,
                label: meta.label,
                category: meta.category,
                xpAwarded: reward.xp,
                streakFreezeAwarded: reward.streakFreeze,
                unlockedAt: now,
            });
        }

        if (totalXp > 0) {
            await this.userLevelService.awardXp(tx, userLoginId, totalXp);
        }

        if (freezesToAdd > 0) {
            // Grant freezes up to the cap; the habit row exists because unlock
            // detection runs after recordPractice has created/updated it.
            const habit = await tx.dailyHabit.findUnique({
                where: { userLoginId },
                select: { streakFreezes: true },
            });
            if (habit) {
                const capped = Math.min(
                    MAX_STREAK_FREEZES,
                    habit.streakFreezes + freezesToAdd,
                );
                if (capped !== habit.streakFreezes) {
                    await tx.dailyHabit.update({
                        where: { userLoginId },
                        data: { streakFreezes: capped },
                    });
                }
            }
        }

        return unlocked;
    }
}
