import { PrismaService } from '@/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import {
    DEFAULT_LEARNING_SETTINGS,
    LearningSettingsResponseDto,
    UpdateLearningSettingsDto,
} from './dto/learning-settings.dto';

@Injectable()
export class LearningSettingsService {
    constructor(private readonly prisma: PrismaService) {}

    /** Read the user's settings, falling back to defaults without creating a row. */
    async getSettings(
        userLoginId: string,
    ): Promise<LearningSettingsResponseDto> {
        const row = await this.prisma.userLearningSettings.findUnique({
            where: { userLoginId },
        });
        return {
            dailyNewWordLimit:
                row?.dailyNewWordLimit ??
                DEFAULT_LEARNING_SETTINGS.dailyNewWordLimit,
            dailyReviewLimit:
                row?.dailyReviewLimit ??
                DEFAULT_LEARNING_SETTINGS.dailyReviewLimit,
            leechThreshold:
                row?.leechThreshold ?? DEFAULT_LEARNING_SETTINGS.leechThreshold,
            leechAutoSuspend:
                row?.leechAutoSuspend ??
                DEFAULT_LEARNING_SETTINGS.leechAutoSuspend,
        };
    }

    async updateSettings(
        userLoginId: string,
        body: UpdateLearningSettingsDto,
    ): Promise<LearningSettingsResponseDto> {
        const row = await this.prisma.userLearningSettings.upsert({
            where: { userLoginId },
            create: { userLoginId, ...body },
            update: { ...body },
        });
        return {
            dailyNewWordLimit: row.dailyNewWordLimit,
            dailyReviewLimit: row.dailyReviewLimit,
            leechThreshold: row.leechThreshold,
            leechAutoSuspend: row.leechAutoSuspend,
        };
    }
}
