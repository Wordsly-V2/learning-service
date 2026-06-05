import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';

export const DAILY_GOAL_WORDS = 10;

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

export class DailyHabitResponseDto {
  @ApiProperty({ example: '2026-06-05' })
  date: string;

  @ApiProperty({ example: 7 })
  wordsToday: number;

  @ApiProperty({ example: 3 })
  streak: number;

  @ApiPropertyOptional({ example: '2026-06-05', nullable: true })
  lastPracticeDate: string | null;

  @ApiProperty({ example: DAILY_GOAL_WORDS })
  goal: number;
}
