import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsBoolean, IsOptional, Max, Min } from 'class-validator';

/** Defaults for a user with no settings row yet (mirror schema defaults). */
export const DEFAULT_LEARNING_SETTINGS = {
    dailyNewWordLimit: 10,
    dailyReviewLimit: 100,
    leechThreshold: 8,
    leechAutoSuspend: false,
} as const;

export class LearningSettingsResponseDto {
    @ApiProperty({
        description: 'Max new words introduced per day',
        example: 10,
    })
    dailyNewWordLimit: number;

    @ApiProperty({ description: 'Max reviews served per day', example: 100 })
    dailyReviewLimit: number;

    @ApiProperty({
        description: 'Lapses at which a card is flagged a leech',
        example: 8,
    })
    leechThreshold: number;

    @ApiProperty({
        description: 'Whether leeches are auto-suspended from reviews',
        example: false,
    })
    leechAutoSuspend: boolean;
}

export class UpdateLearningSettingsDto {
    @ApiPropertyOptional({ description: 'Max new words per day', example: 10 })
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(100)
    dailyNewWordLimit?: number;

    @ApiPropertyOptional({ description: 'Max reviews per day', example: 100 })
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(1000)
    dailyReviewLimit?: number;

    @ApiPropertyOptional({ description: 'Leech lapse threshold', example: 8 })
    @IsOptional()
    @IsInt()
    @Min(2)
    @Max(30)
    leechThreshold?: number;

    @ApiPropertyOptional({
        description: 'Auto-suspend leeches',
        example: false,
    })
    @IsOptional()
    @IsBoolean()
    leechAutoSuspend?: boolean;
}
