import {
    ArrayMaxSize,
    ArrayNotEmpty,
    IsArray,
    IsIn,
    IsInt,
    IsOptional,
    IsUUID,
    Max,
    Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsClientDate } from '@/daily-habit/daily-habit-date.util';
import {
    ITEM_SOURCE_PARAMS,
    type ItemSourceParam,
} from '@/word-scope/item-source';
import {
    MAX_SUMMARY_IDS,
    RESET_SCOPES,
    type ResetScope,
    type RetentionCohort,
    type DailyActivity,
} from '../admin-learning.logic';

export class LearningStatsQueryDto {
    /** Inclusive day, `YYYY-MM-DD`. Defaults to 30 days before `to`. */
    @IsOptional()
    @IsClientDate()
    from?: string;

    /** Inclusive day, `YYYY-MM-DD`. Defaults to today (UTC). */
    @IsOptional()
    @IsClientDate()
    to?: string;
}

export class UsersSummaryDto {
    @IsArray()
    @ArrayNotEmpty()
    @ArrayMaxSize(MAX_SUMMARY_IDS)
    @IsUUID('all', { each: true })
    ids!: string[];
}

export class ResetProgressDto {
    @IsIn(RESET_SCOPES)
    scope!: ResetScope;

    /** Only for `cards`: clear one source's cards and keep the other's. */
    @IsOptional()
    @IsIn(ITEM_SOURCE_PARAMS)
    source?: ItemSourceParam;
}

export class HardestItemsQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;

    /** Ignore items fewer learners than this have answered (noise). */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(1000)
    minLearners?: number;
}

export interface LearningStats {
    from: string;
    to: string;
    /** Distinct learners active on `to`, in the 7 and the 30 days ending on it. */
    activeToday: number;
    weeklyActive: number;
    monthlyActive: number;
    /** Distinct learners active anywhere in the range. */
    activeInRange: number;
    totals: { reviews: number; correctReviews: number; newWords: number };
    daily: DailyActivity[];
    /** Live streaks only (see `isStreakAlive`). */
    streaks: { label: string; learners: number }[];
    levels: { level: number; learners: number }[];
    /** Weekly cohorts of learners first active within the range. */
    retention: RetentionCohort[];
    cards: { source: string; cards: number; due: number }[];
}

export interface LearnerSummary {
    userLoginId: string;
    /** Last day with any practice or answer, on the learner's calendar. */
    lastActiveDate: string | null;
    streak: number;
    level: number;
    totalXp: number;
    cards: number;
    dueNow: number;
}

export interface CardCounts {
    source: string;
    cards: number;
    due: number;
    leeches: number;
    suspended: number;
}

export interface LearnerOverview {
    userLoginId: string;
    lastActiveDate: string | null;
    habit: {
        streak: number;
        streakAlive: boolean;
        longestStreak: number;
        dailyGoal: number;
        totalPracticeDays: number;
        lastPracticeDate: string | null;
        streakFreezes: number;
    } | null;
    level: { level: number; totalXp: number };
    cards: CardCounts[];
    achievements: number;
}

export interface ResetResult {
    scope: ResetScope;
    source: ItemSourceParam | null;
    /** Rows removed or reset, per table. */
    affected: Record<string, number>;
}

export interface HardItem {
    itemId: string;
    learners: number;
    reviews: number;
    accuracy: number;
    lapses: number;
}
