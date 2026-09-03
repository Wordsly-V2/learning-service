import {
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
    LearningSettingsResponseDto,
    UpdateLearningSettingsDto,
} from './dto/learning-settings.dto';
import { LearningSettingsService } from './learning-settings.service';

@ApiTags('users/:userLoginId/learning-settings')
@Controller('users/:userLoginId/learning-settings')
@ApiParam({
    name: 'userLoginId',
    description: 'User login ID',
    example: '01936c1e-1234-7890-abcd-ef1234567890',
})
export class LearningSettingsController {
    constructor(
        private readonly learningSettingsService: LearningSettingsService,
    ) {}

    @Get()
    @ApiOperation({ summary: 'Get learning pacing/leech settings' })
    @ApiResponse({ status: 200, type: LearningSettingsResponseDto })
    async getSettings(
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
    ): Promise<LearningSettingsResponseDto> {
        return this.learningSettingsService.getSettings(userLoginId);
    }

    @Patch()
    @ApiOperation({ summary: 'Update learning pacing/leech settings' })
    @ApiResponse({ status: 200, type: LearningSettingsResponseDto })
    async updateSettings(
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
        @Body() body: UpdateLearningSettingsDto,
    ): Promise<LearningSettingsResponseDto> {
        return this.learningSettingsService.updateSettings(userLoginId, body);
    }
}
