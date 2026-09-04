import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
    LearningSettingsResponseDto,
    UpdateLearningSettingsDto,
} from './dto/learning-settings.dto';
import { LearningSettingsService } from './learning-settings.service';
import { CurrentUser } from '@/auth/jwt/current-user.decorator';

@ApiTags('learning-settings')
@Controller('learning-settings')
export class LearningSettingsController {
    constructor(
        private readonly learningSettingsService: LearningSettingsService,
    ) {}

    @Get()
    @ApiOperation({ summary: 'Get learning pacing/leech settings' })
    @ApiResponse({ status: 200, type: LearningSettingsResponseDto })
    async getSettings(
        @CurrentUser() userLoginId: string,
    ): Promise<LearningSettingsResponseDto> {
        return this.learningSettingsService.getSettings(userLoginId);
    }

    @Patch()
    @ApiOperation({ summary: 'Update learning pacing/leech settings' })
    @ApiResponse({ status: 200, type: LearningSettingsResponseDto })
    async updateSettings(
        @CurrentUser() userLoginId: string,
        @Body() body: UpdateLearningSettingsDto,
    ): Promise<LearningSettingsResponseDto> {
        return this.learningSettingsService.updateSettings(userLoginId, body);
    }
}
