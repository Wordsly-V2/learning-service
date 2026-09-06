/**
 * Pure logic for persisted achievements: which achievement keys a user's totals
 * satisfy, which are newly unlocked versus already recorded, and the XP reward
 * each unlock grants. No I/O.
 */

import {
    Achievement,
    AchievementInput,
    computeAchievements,
} from '@/learning-report/learning-report.logic';

export interface AchievementReward {
    xp: number;
}

/**
 * Reward for unlocking an achievement, derived from its key: XP scaling with the
 * milestone tier, and nothing else. Streak achievements used to also grant a
 * streak freeze, but the freeze balance is now derived from the DailyHabitDay
 * ledger (see recomputeHabitFromDays) — a grant written straight to the column
 * would be erased by the next recompute, so freezes come from the earn cadence
 * alone.
 */
export function achievementReward(key: string): AchievementReward {
    const [category, targetStr] = key.split('-');
    const target = Number(targetStr) || 0;
    switch (category) {
        case 'streak':
            // 50 XP for the first tier, scaling with the milestone size.
            return { xp: Math.min(300, 50 + target) };
        case 'words':
            return { xp: Math.min(300, 25 + Math.round(target / 10)) };
        case 'days':
            return { xp: Math.min(300, 50 + target) };
        default:
            return { xp: 25 };
    }
}

/** Keys of achievements currently satisfied by the given lifetime totals. */
export function achievedKeys(input: AchievementInput): string[] {
    return computeAchievements(input)
        .filter((a: Achievement) => a.achieved)
        .map((a) => a.key);
}

/** Keys satisfied now that were not already recorded as unlocked. */
export function diffNewlyUnlocked(
    input: AchievementInput,
    existingKeys: Set<string>,
): string[] {
    return achievedKeys(input).filter((key) => !existingKeys.has(key));
}
