import { InternalServiceGuard } from '@/guard/internal-service/internal-service.guard';
import {
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
    UpdateUserPreferencesDto,
    UserPreferencesResponseDto,
} from './dto/user-preferences.dto';
import { UserPreferencesService } from './user-preferences.service';

@ApiTags('users/:userLoginId/preferences')
@Controller('users/:userLoginId/preferences')
@ApiParam({
    name: 'userLoginId',
    description: 'User login ID',
    example: '01936c1e-1234-7890-abcd-ef1234567890',
})
@UseGuards(InternalServiceGuard)
export class UserPreferencesController {
    constructor(
        private readonly userPreferencesService: UserPreferencesService,
    ) {}

    @Get()
    @ApiOperation({ summary: 'Get synced app/UI preferences' })
    @ApiResponse({ status: 200, type: UserPreferencesResponseDto })
    async getPreferences(
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
    ): Promise<UserPreferencesResponseDto> {
        return this.userPreferencesService.getPreferences(userLoginId);
    }

    @Patch()
    @ApiOperation({
        summary: 'Merge a partial preferences patch (last-write-wins per key)',
    })
    @ApiResponse({ status: 200, type: UserPreferencesResponseDto })
    async updatePreferences(
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
        @Body() body: UpdateUserPreferencesDto,
    ): Promise<UserPreferencesResponseDto> {
        return this.userPreferencesService.updatePreferences(
            userLoginId,
            body.preferences,
        );
    }
}
