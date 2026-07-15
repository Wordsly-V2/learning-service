/**
 * Pure logic for persisted achievements: which achievement keys a user's totals
 * satisfy, which are newly unlocked versus already recorded, and the reward
 * (XP + optional streak freeze) each unlock grants. No I/O.
 */

import {
    Achievement,
    AchievementInput,
    computeAchievements,
} from '@/learning-report/learning-report.logic';

export interface AchievementReward {
    xp: number;
    streakFreeze: boolean;
}

/**
 * Reward for unlocking an achievement, derived from its key. Streak
 * achievements also grant a freeze (capped by the caller at MAX_STREAK_FREEZES);
 * XP scales with the milestone tier.
 */
export function achievementReward(key: string): AchievementReward {
    const [category, targetStr] = key.split('-');
    const target = Number(targetStr) || 0;
    switch (category) {
        case 'streak':
            // 50 XP for the first tier, scaling with the milestone size.
            return { xp: Math.min(300, 50 + target), streakFreeze: true };
        case 'words':
            return {
                xp: Math.min(300, 25 + Math.round(target / 10)),
                streakFreeze: false,
            };
        case 'days':
            return { xp: Math.min(300, 50 + target), streakFreeze: false };
        default:
            return { xp: 25, streakFreeze: false };
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
