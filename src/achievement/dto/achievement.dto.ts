import { ApiProperty } from '@nestjs/swagger';
import {
    ACHIEVEMENT_CATEGORIES,
    type AchievementCategory,
} from '@/learning-report/learning-report.logic';

/** An achievement unlocked during a write, so the client can celebrate it. */
export class UnlockedAchievementDto {
    @ApiProperty({ description: 'Achievement key', example: 'streak-7' })
    key: string;

    @ApiProperty({ description: 'Human label', example: '7-day streak' })
    label: string;

    @ApiProperty({
        description: 'Category',
        example: 'streak',
        enum: ACHIEVEMENT_CATEGORIES,
    })
    category: AchievementCategory;

    @ApiProperty({ description: 'XP awarded for the unlock', example: 57 })
    xpAwarded: number;

    @ApiProperty({ description: 'When it was unlocked' })
    unlockedAt: Date;
}
