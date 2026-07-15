/**
 * One-time backfill: record achievements each user has already earned so the
 * persisted-achievements feature doesn't re-fire unlock celebrations/rewards
 * for milestones they passed long ago.
 *
 * Deliberately awards NO retroactive XP or streak freezes (xpAwarded = 0) to
 * avoid XP inflation; unlockedAt is set to the habit row's updatedAt.
 *
 * Run after `prisma migrate deploy`:
 *   npx ts-node -r tsconfig-paths/register prisma/backfill-achievements.ts
 * Idempotent: existing rows are left untouched (skipDuplicates).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { achievedKeys } from '../src/achievement/achievement.logic';

async function main() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    try {
        const habits = await prisma.dailyHabit.findMany({
            select: {
                userLoginId: true,
                longestStreak: true,
                totalWordsPracticed: true,
                totalPracticeDays: true,
                updatedAt: true,
            },
        });

        let inserted = 0;
        for (const habit of habits) {
            const keys = achievedKeys({
                longestStreak: habit.longestStreak,
                totalWordsPracticed: habit.totalWordsPracticed,
                totalPracticeDays: habit.totalPracticeDays,
            });
            if (keys.length === 0) continue;
            const result = await prisma.userAchievement.createMany({
                data: keys.map((key) => ({
                    userLoginId: habit.userLoginId,
                    key,
                    unlockedAt: habit.updatedAt,
                    xpAwarded: 0,
                })),
                skipDuplicates: true,
            });
            inserted += result.count;
        }

        console.log(
            `Backfilled ${inserted} achievement rows across ${habits.length} users.`,
        );
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
