import { PrismaService } from '@/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';

/** Rows removed per table by `purgeUser`, for the log line. */
export type PurgedRows = Record<string, number>;

/** Everything learning-service holds for one user, as a whole. */
@Injectable()
export class UserDataService {
    private readonly logger = new Logger(UserDataService.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Delete every row of a deleted account, in one transaction. Idempotent:
     * a second run finds nothing and removes nothing. A new table that holds
     * a `userLoginId` belongs here too.
     */
    async purgeUser(userLoginId: string): Promise<PurgedRows> {
        const where = { userLoginId };
        const purged = await this.prisma.$transaction(async (tx) => ({
            wordProgress: (await tx.wordProgress.deleteMany({ where })).count,
            savedWord: (await tx.savedWord.deleteMany({ where })).count,
            // Days before the habit they belong to (foreign key).
            dailyHabitDay: (await tx.dailyHabitDay.deleteMany({ where })).count,
            dailyHabit: (await tx.dailyHabit.deleteMany({ where })).count,
            dailyHabitGrant: (await tx.dailyHabitGrant.deleteMany({ where }))
                .count,
            dailyReviewStat: (await tx.dailyReviewStat.deleteMany({ where }))
                .count,
            dailyPracticedWord: (
                await tx.dailyPracticedWord.deleteMany({ where })
            ).count,
            userLevel: (await tx.userLevel.deleteMany({ where })).count,
            userAchievement: (await tx.userAchievement.deleteMany({ where }))
                .count,
            pathProgressTotals: (
                await tx.pathProgressTotals.deleteMany({ where })
            ).count,
            notificationPreference: (
                await tx.notificationPreference.deleteMany({ where })
            ).count,
            pushSubscription: (await tx.pushSubscription.deleteMany({ where }))
                .count,
            userLearningSettings: (
                await tx.userLearningSettings.deleteMany({ where })
            ).count,
            userPreferences: (await tx.userPreferences.deleteMany({ where }))
                .count,
            syncRequest: (await tx.syncRequest.deleteMany({ where })).count,
        }));
        this.logger.log(
            `user_purged ${JSON.stringify({ userLoginId, purged })}`,
        );
        return purged;
    }
}
