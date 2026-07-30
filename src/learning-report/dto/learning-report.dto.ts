import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { CLIENT_DATE_PATTERN } from '@/word-progress/dto/word-progress.dto';
import type { ReportGranularity, ReportPeriod } from '../learning-report.logic';

export const REPORT_PERIODS: ReportPeriod[] = ['week', 'month', 'year'];

export class ReviewForecastQueryDto {
    @ApiPropertyOptional({
        description: 'Forecast horizon in days',
        example: 7,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @IsIn([7, 30])
    days?: number = 7;

    @ApiPropertyOptional({
        description: 'Client local calendar date (YYYY-MM-DD)',
        example: '2026-06-23',
    })
    @IsOptional()
    @IsString()
    @Matches(CLIENT_DATE_PATTERN)
    clientDate?: string;
}

export class ActivityCalendarQueryDto {
    @ApiPropertyOptional({
        description: 'Client local calendar date (YYYY-MM-DD)',
        example: '2026-06-23',
    })
    @IsOptional()
    @IsString()
    @Matches(CLIENT_DATE_PATTERN)
    clientDate?: string;
}

export class LearningReportQueryDto {
    @ApiPropertyOptional({
        description: 'Reporting window',
        enum: REPORT_PERIODS,
        default: 'week',
    })
    @IsOptional()
    @IsIn(REPORT_PERIODS)
    period?: ReportPeriod = 'week';

    @ApiPropertyOptional({
        description: 'Client local calendar date (YYYY-MM-DD), anchors "today"',
        example: '2026-06-23',
    })
    @IsOptional()
    @IsString()
    @Matches(CLIENT_DATE_PATTERN)
    clientDate?: string;
}

export class ReportRangeDto {
    @ApiProperty({ example: '2026-06-17' })
    start: string;

    @ApiProperty({ example: '2026-06-23' })
    end: string;
}

export class ReportBucketDto {
    @ApiProperty({
        description: "Bucket key: 'YYYY-MM-DD' (daily) or 'YYYY-MM' (monthly)",
        example: '2026-06-23',
    })
    key: string;

    @ApiProperty({
        description: 'First calendar date of the bucket',
        example: '2026-06-23',
    })
    start: string;

    @ApiProperty({
        description: 'Distinct words practiced (new + reviewed)',
        example: 12,
    })
    wordsPracticed: number;

    @ApiProperty({
        description: 'Words practiced that had been seen before this bucket',
        example: 7,
    })
    reviewedWords: number;

    @ApiProperty({ example: 18 })
    reviews: number;

    @ApiProperty({ example: 15 })
    correctReviews: number;

    @ApiProperty({
        description:
            'Correct-answer percentage, or null when no reviews that bucket',
        example: 83.3,
        nullable: true,
    })
    accuracy: number | null;

    @ApiProperty({
        description: 'Days with any practice in this bucket',
        example: 1,
    })
    daysActive: number;

    @ApiProperty({
        description: 'Days the daily goal was met in this bucket',
        example: 1,
    })
    goalMetDays: number;

    @ApiProperty({ description: 'Words first seen in this bucket', example: 5 })
    newWords: number;
}

export class ReportSummaryDto {
    @ApiProperty({
        description: 'Words practiced across the window (new + reviewed)',
        example: 84,
    })
    wordsLearned: number;

    @ApiProperty({
        description: 'Practiced words that were already known before',
        example: 64,
    })
    reviewedWords: number;

    @ApiProperty({ example: 120 })
    totalReviews: number;

    @ApiProperty({ example: 87.5 })
    avgAccuracy: number;

    @ApiProperty({ example: 6 })
    activeDays: number;

    @ApiProperty({ example: 5 })
    goalMetDays: number;

    @ApiProperty({ example: 20 })
    newWords: number;
}

export class ReportMasteryDto {
    @ApiProperty({
        description: 'Cards still in the learning/relearning phase',
        example: 30,
    })
    learningWords: number;

    @ApiProperty({
        description: 'Cards in review but not yet mastered',
        example: 45,
    })
    reviewWords: number;

    @ApiProperty({
        description: 'Review cards with a long interval',
        example: 25,
    })
    masteredWords: number;

    @ApiProperty({
        description: 'Total words the user has started learning',
        example: 100,
    })
    totalStarted: number;

    @ApiProperty({
        description: 'Cards flagged as leeches (repeatedly lapsed)',
        example: 3,
    })
    leeches: number;
}

export class ReportStreaksDto {
    @ApiProperty({ example: 6 })
    current: number;

    @ApiProperty({ example: 21 })
    longest: number;

    @ApiProperty({ example: 4 })
    goalStreak: number;

    @ApiProperty({ example: 14 })
    longestGoalStreak: number;
}

export class ReportLevelDto {
    @ApiProperty({ description: 'Current numeric level', example: 7 })
    level: number;

    @ApiProperty({
        description: 'Named rank tier for the level',
        example: 'Apprentice',
    })
    rank: string;

    @ApiProperty({ description: 'Cumulative XP earned all-time', example: 430 })
    totalXp: number;

    @ApiProperty({
        description: 'XP earned within the current level',
        example: 130,
    })
    currentLevelXp: number;

    @ApiProperty({
        description: 'Total XP span of the current level',
        example: 200,
    })
    xpForThisLevel: number;

    @ApiProperty({
        description: 'XP still needed to reach the next level',
        example: 70,
    })
    xpToNextLevel: number;

    @ApiProperty({
        description: 'Progress through the current level, 0..100',
        example: 65,
    })
    progress: number;
}

export class ReportAchievementDto {
    @ApiProperty({ example: 'streak-7' })
    key: string;

    @ApiProperty({ example: '7-day streak' })
    label: string;

    @ApiProperty({ enum: ['streak', 'words', 'days'], example: 'streak' })
    category: 'streak' | 'words' | 'days';

    @ApiProperty({ example: true })
    achieved: boolean;

    @ApiProperty({
        description: 'Current progress value toward the target',
        example: 21,
    })
    value: number;

    @ApiProperty({ example: 7 })
    target: number;

    @ApiPropertyOptional({
        description: 'When the achievement was unlocked (if persisted)',
        example: '2026-06-20T09:15:44.000Z',
        nullable: true,
    })
    unlockedAt?: Date | null;
}

export class ForecastBucketDto {
    @ApiProperty({ example: '2026-06-24' })
    date: string;

    @ApiProperty({ description: 'Reviews scheduled that day', example: 12 })
    count: number;
}

export class ReviewForecastResponseDto {
    @ApiProperty({ example: 7 })
    days: number;

    @ApiProperty({ example: '2026-06-24' })
    start: string;

    @ApiProperty({ description: 'Reviews already overdue', example: 8 })
    overdue: number;

    @ApiProperty({
        description: 'Total upcoming reviews in the window',
        example: 54,
    })
    total: number;

    @ApiProperty({ type: [ForecastBucketDto] })
    buckets: ForecastBucketDto[];
}

export class ActivityDayDto {
    @ApiProperty({ example: '2026-06-24' })
    date: string;

    @ApiProperty({ example: 15 })
    wordsPracticed: number;

    @ApiProperty({ example: true })
    goalMet: boolean;
}

export class ActivityCalendarResponseDto {
    @ApiProperty({ example: '2025-06-24' })
    start: string;

    @ApiProperty({ example: '2026-06-24' })
    end: string;

    @ApiProperty({ type: [ActivityDayDto] })
    days: ActivityDayDto[];
}

export class LearningReportResponseDto {
    @ApiProperty({ enum: REPORT_PERIODS, example: 'week' })
    period: ReportPeriod;

    @ApiProperty({ enum: ['day', 'month'], example: 'day' })
    granularity: ReportGranularity;

    @ApiProperty({ type: ReportRangeDto })
    range: ReportRangeDto;

    @ApiProperty({ type: [ReportBucketDto] })
    buckets: ReportBucketDto[];

    @ApiProperty({ type: ReportSummaryDto })
    summary: ReportSummaryDto;

    @ApiProperty({ type: ReportMasteryDto })
    mastery: ReportMasteryDto;

    @ApiProperty({ type: ReportStreaksDto })
    streaks: ReportStreaksDto;

    @ApiProperty({ type: ReportLevelDto })
    level: ReportLevelDto;

    @ApiProperty({ type: [ReportAchievementDto] })
    achievements: ReportAchievementDto[];
}
