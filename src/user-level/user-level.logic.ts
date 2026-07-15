/**
 * Pure functions for the user learning level: the XP curve, rank tiers, and the
 * XP awarded per learning/practice event. Everything tunable about leveling
 * lives here (pattern mirrors learning-report.logic.ts), with no I/O.
 */

import { MASTERED_INTERVAL_DAYS } from '@/learning-report/learning-report.logic';

/** FSRS State enum value for cards in the Review phase. */
export const FSRS_STATE_REVIEW = 2;

// --- Per-answer XP (awarded by word-progress) ---------------------------------
export const XP_PER_REVIEW = 2;
export const XP_CORRECT = 3;
export const XP_PERFECT = 1;
export const XP_NEW_WORD = 5;
export const XP_MASTERED = 25;

// --- Consistency XP (awarded by daily-habit) ----------------------------------
export const XP_FIRST_PRACTICE_OF_DAY = 10;
export const XP_DAILY_GOAL_MET = 15;
export const XP_STREAK_MILESTONE = 100;

/** Quality at/above which an answer counts as correct (CORRECT_WITH_DIFFICULTY). */
const CORRECT_QUALITY = 3;
/** Quality for a perfect answer (PERFECT). */
const PERFECT_QUALITY = 5;

/** A Review-state card with a long-enough interval is "mastered". */
export function isMastered(state: number, interval: number): boolean {
    return state === FSRS_STATE_REVIEW && interval >= MASTERED_INTERVAL_DAYS;
}

/** XP earned for a single recorded answer, given before/after signals. */
export function xpForAnswer(a: {
    quality: number;
    isNewWord: boolean;
    wasMastered: boolean;
    isMastered: boolean;
}): number {
    let xp = XP_PER_REVIEW;
    if (a.quality >= CORRECT_QUALITY) {
        xp += XP_CORRECT;
    }
    if (a.quality >= PERFECT_QUALITY) {
        xp += XP_PERFECT;
    }
    if (a.isNewWord) {
        xp += XP_NEW_WORD;
    }
    // Award the mastery bonus only on the crossing into mastery.
    if (!a.wasMastered && a.isMastered) {
        xp += XP_MASTERED;
    }
    return xp;
}

// --- Streak XP multiplier -----------------------------------------------------

/**
 * Goal-streak tiers that scale per-answer XP. A longer daily streak multiplies
 * the learning XP earned that day, rewarding consistency. Ordered by descending
 * threshold so the first match wins.
 */
export const STREAK_MULTIPLIER_TIERS = [
    { minGoalStreak: 30, multiplier: 1.5 },
    { minGoalStreak: 7, multiplier: 1.25 },
    { minGoalStreak: 3, multiplier: 1.1 },
] as const;

/** Multiplier applied to per-answer XP for the given goal streak (1 when none). */
export function streakXpMultiplier(goalStreak: number): number {
    for (const tier of STREAK_MULTIPLIER_TIERS) {
        if (goalStreak >= tier.minGoalStreak) {
            return tier.multiplier;
        }
    }
    return 1;
}

/** Apply the streak multiplier to a base XP amount, rounded to an integer. */
export function applyStreakMultiplier(
    baseXp: number,
    goalStreak: number,
): number {
    if (baseXp <= 0) {
        return baseXp;
    }
    return Math.round(baseXp * streakXpMultiplier(goalStreak));
}

// --- Level curve --------------------------------------------------------------

/** Steepness of the quadratic XP curve. */
export const XP_LEVEL_COEFFICIENT = 50;

/**
 * Cumulative XP needed to *reach* a level.
 * L1=0, L2=100, L3=300, L4=600, L5=1000, L10=4500, L20=19000.
 */
export function xpToReachLevel(level: number): number {
    if (level <= 1) {
        return 0;
    }
    return XP_LEVEL_COEFFICIENT * (level - 1) * level;
}

/** Highest level whose threshold is at or below totalXp (closed-form inverse). */
export function levelFromXp(totalXp: number): number {
    if (totalXp <= 0) {
        return 1;
    }
    // Invert 50*(L^2 - L) <= xp  ->  L = floor((1 + sqrt(1 + 4*xp/50)) / 2).
    // The epsilon absorbs float error so exact thresholds floor to the new level.
    const level = Math.floor(
        (1 + Math.sqrt(1 + totalXp / (XP_LEVEL_COEFFICIENT / 4))) / 2 + 1e-9,
    );
    return Math.max(1, level);
}

// --- Ranks --------------------------------------------------------------------

/** Named rank tiers, layered over the numeric level. Ordered by ascending level. */
export const RANKS = [
    { name: 'Novice', minLevel: 1 },
    { name: 'Apprentice', minLevel: 5 },
    { name: 'Skilled', minLevel: 10 },
    { name: 'Expert', minLevel: 20 },
    { name: 'Master', minLevel: 35 },
    { name: 'Grandmaster', minLevel: 50 },
] as const;

/** The rank name for a given level (highest tier whose minLevel <= level). */
export function rankForLevel(level: number): string {
    let rank = RANKS[0].name as string;
    for (const tier of RANKS) {
        if (level >= tier.minLevel) {
            rank = tier.name;
        }
    }
    return rank;
}

export interface LevelProgress {
    level: number;
    rank: string;
    totalXp: number;
    /** XP earned within the current level (toward the next). */
    currentLevelXp: number;
    /** Total XP span of the current level. */
    xpForThisLevel: number;
    /** XP still needed to reach the next level. */
    xpToNextLevel: number;
    /** Progress through the current level, 0..100 (one decimal). */
    progress: number;
}

/** Resolve a full progress snapshot from cumulative XP. */
export function computeLevelProgress(totalXp: number): LevelProgress {
    const xp = Math.max(0, totalXp);
    const level = levelFromXp(xp);
    const floor = xpToReachLevel(level);
    const ceil = xpToReachLevel(level + 1);
    const xpForThisLevel = ceil - floor;
    const currentLevelXp = xp - floor;
    const xpToNextLevel = ceil - xp;
    const progress =
        xpForThisLevel > 0
            ? Math.round((currentLevelXp / xpForThisLevel) * 100 * 10) / 10
            : 0;
    return {
        level,
        rank: rankForLevel(level),
        totalXp: xp,
        currentLevelXp,
        xpForThisLevel,
        xpToNextLevel,
        progress,
    };
}
