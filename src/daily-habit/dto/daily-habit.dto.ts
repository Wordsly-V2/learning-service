import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    Max,
    Min,
    ValidateNested,
} from 'class-validator';
import { UnlockedAchievementDto } from '@/achievement/dto/achievement.dto';

export const DAILY_GOAL_WORDS = 10;
export const DAILY_GOAL_MIN = 5;
export const DAILY_GOAL_MAX = 50;
export const ACTIVITY_HISTORY_DAYS = 7;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class DailyHabitQueryDto {
    @ApiPropertyOptional({
        description: 'Client local calendar date (YYYY-MM-DD)',
        example: '2026-06-05',
    })
    @IsOptional()
    @IsString()
    @Matches(DATE_PATTERN)
    clientDate?: string;
}

export class RecordDailyPracticeDto {
    @ApiProperty({
        description: 'Number of words practiced in this session',
        example: 5,
        minimum: 1,
    })
    @IsInt()
    @Min(1)
    wordCount: number;

    @ApiProperty({
        description: 'Client local calendar date (YYYY-MM-DD)',
        example: '2026-06-05',
    })
    @IsString()
    @Matches(DATE_PATTERN)
    clientDate: string;
}

/** Distinct calendar days one batched flush may cover. */
export const MAX_BATCH_PRACTICE_DAYS = 60;

/** Practice days older than this are dropped rather than recorded. */
export const MAX_BACKDATED_HABIT_DAYS = 90;

export class DailyPracticeDayDto {
    @ApiProperty({
        description: 'Client local calendar date (YYYY-MM-DD)',
        example: '2026-08-11',
    })
    @IsString()
    @Matches(DATE_PATTERN)
    clientDate: string;

    @ApiProperty({
        description: 'Words practiced on that day',
        example: 12,
        minimum: 1,
        maximum: 1000,
    })
    @IsInt()
    @Min(1)
    @Max(1000)
    wordCount: number;
}

export class BatchRecordDailyPracticeDto {
    @ApiProperty({
        description:
            'One entry per local calendar day held offline. Duplicate dates are summed.',
        type: [DailyPracticeDayDto],
    })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(MAX_BATCH_PRACTICE_DAYS)
    @ValidateNested({ each: true })
    @Type(() => DailyPracticeDayDto)
    days: DailyPracticeDayDto[];

    @ApiProperty({
        description:
            "The client's TODAY — anchors wordsToday, practiceDate and streak decay.",
        example: '2026-08-13',
    })
    @IsString()
    @Matches(DATE_PATTERN)
    clientDate: string;

    @ApiPropertyOptional({
        description:
            'Client-generated UUID identifying this flush. Replaying the same id returns the original response without re-applying XP.',
        example: '01936b3e-7c8f-7890-abcd-ef1234567890',
    })
    @IsOptional()
    @IsUUID()
    clientRequestId?: string;
}

export class UpdateDailyGoalDto {
    @ApiProperty({
        description: 'Daily word goal',
        example: 15,
        minimum: DAILY_GOAL_MIN,
        maximum: DAILY_GOAL_MAX,
    })
    @IsInt()
    @Min(DAILY_GOAL_MIN)
    @Max(DAILY_GOAL_MAX)
    dailyGoal: number;
}

export class DailyHabitDayDto {
    @ApiProperty({ example: '2026-06-05' })
    date: string;

    @ApiProperty({ example: 12 })
    words: number;

    @ApiProperty({ example: true })
    goalMet: boolean;
}

export class DailyHabitResponseDto {
    @ApiProperty({ example: '2026-06-05' })
    date: string;

    @ApiProperty({ example: 7 })
    wordsToday: number;

    @ApiProperty({ example: 3 })
    streak: number;

    @ApiProperty({ example: 12 })
    longestStreak: number;

    @ApiProperty({ example: 2 })
    goalStreak: number;

    @ApiProperty({ example: 5 })
    longestGoalStreak: number;

    @ApiPropertyOptional({ example: '2026-06-05', nullable: true })
    lastPracticeDate: string | null;

    @ApiProperty({ example: 10 })
    goal: number;

    @ApiProperty({ example: false })
    goalMetToday: boolean;

    @ApiProperty({ example: 240 })
    totalWordsPracticed: number;

    @ApiProperty({ example: 18 })
    totalPracticeDays: number;

    @ApiProperty({ example: 42 })
    wordsThisWeek: number;

    @ApiProperty({ example: 5 })
    daysActiveThisWeek: number;

    @ApiProperty({ type: [DailyHabitDayDto] })
    recentDays: DailyHabitDayDto[];

    @ApiProperty({
        description:
            'Practiced yesterday but not yet today — one missed day breaks the streak',
        example: true,
    })
    streakAtRisk: boolean;

    @ApiPropertyOptional({
        description:
            'Next streak length worth celebrating, or null when past the top milestone',
        example: 30,
        nullable: true,
    })
    nextMilestone: number | null;

    @ApiProperty({
        description:
            'Banked streak freezes that auto-protect the streak on a missed day. Freezes already bridging missed days are deducted here, before the next session writes the consumption.',
        example: 1,
    })
    streakFreezes: number;

    @ApiProperty({
        description:
            'A banked freeze is currently bridging one or more missed days',
        example: false,
    })
    streakShielded: boolean;

    @ApiProperty({ example: 'Almost there — 2 more words to hit your goal.' })
    message: string;

    @ApiPropertyOptional({
        description: 'Achievements unlocked by this practice, if any',
        type: [UnlockedAchievementDto],
    })
    unlockedAchievements?: UnlockedAchievementDto[];
}
