/**
 * One-time backfill: seed UserLevel.totalXp from each user's existing history so
 * current users don't reset to Level 1 when leveling ships.
 *
 * It approximates the live XP rules from aggregates (per-answer "perfect" can't
 * be recovered from totals, so the +1 perfect bonus is omitted — acceptable).
 *
 * Run after `prisma migrate deploy`:
 *   npx ts-node -r tsconfig-paths/register prisma/backfill-user-level.ts
 * Idempotent: re-running recomputes from history and overwrites each row.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { STREAK_MILESTONES } from '../src/daily-habit/daily-habit.logic';
import {
    FSRS_STATE_REVIEW,
    levelFromXp,
    XP_CORRECT,
    XP_DAILY_GOAL_MET,
    XP_FIRST_PRACTICE_OF_DAY,
    XP_MASTERED,
    XP_NEW_WORD,
    XP_PER_REVIEW,
    XP_STREAK_MILESTONE,
} from '../src/user-level/user-level.logic';
import { MASTERED_INTERVAL_DAYS } from '../src/learning-report/learning-report.logic';

function streakMilestoneXp(longestStreak: number): number {
    const reached = STREAK_MILESTONES.filter(
        (m) => m <= longestStreak,
    ).length;
    return reached * XP_STREAK_MILESTONE;
}

async function main() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    try {
        // Per-user learning aggregates from the per-word table.
        const wordAgg = await prisma.wordProgress.groupBy({
            by: ['userLoginId'],
            _count: { _all: true },
            _sum: { totalReviews: true, correctReviews: true },
        });
        const masteredAgg = await prisma.wordProgress.groupBy({
            by: ['userLoginId'],
            where: {
                state: FSRS_STATE_REVIEW,
                interval: { gte: MASTERED_INTERVAL_DAYS },
            },
            _count: { _all: true },
        });
        const goalDaysAgg = await prisma.dailyHabitDay.groupBy({
            by: ['userLoginId'],
            where: { goalMet: true },
            _count: { _all: true },
        });
        const habits = await prisma.dailyHabit.findMany({
            select: {
                userLoginId: true,
                totalPracticeDays: true,
                longestStreak: true,
            },
        });

        const masteredByUser = new Map(
            masteredAgg.map((r) => [r.userLoginId, r._count._all]),
        );
        const goalDaysByUser = new Map(
            goalDaysAgg.map((r) => [r.userLoginId, r._count._all]),
        );
        const habitByUser = new Map(habits.map((h) => [h.userLoginId, h]));

        const userIds = new Set<string>([
            ...wordAgg.map((r) => r.userLoginId),
            ...habits.map((h) => h.userLoginId),
        ]);

        let updated = 0;
        for (const userLoginId of userIds) {
            const words = wordAgg.find((r) => r.userLoginId === userLoginId);
            const reviews = words?._sum.totalReviews ?? 0;
            const correct = words?._sum.correctReviews ?? 0;
            const wordsStarted = words?._count._all ?? 0;
            const mastered = masteredByUser.get(userLoginId) ?? 0;
            const habit = habitByUser.get(userLoginId);
            const practiceDays = habit?.totalPracticeDays ?? 0;
            const longestStreak = habit?.longestStreak ?? 0;
            const goalDays = goalDaysByUser.get(userLoginId) ?? 0;

            const totalXp =
                reviews * XP_PER_REVIEW +
                correct * XP_CORRECT +
                wordsStarted * XP_NEW_WORD +
                mastered * XP_MASTERED +
                practiceDays * XP_FIRST_PRACTICE_OF_DAY +
                goalDays * XP_DAILY_GOAL_MET +
                streakMilestoneXp(longestStreak);

            const level = levelFromXp(totalXp);
            await prisma.userLevel.upsert({
                where: { userLoginId },
                create: { userLoginId, totalXp, level },
                update: { totalXp, level },
            });
            updated++;
        }

        console.log(`Backfilled UserLevel for ${updated} users.`);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
