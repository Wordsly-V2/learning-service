import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
    UpdateUserPreferencesDto,
    UserPreferencesResponseDto,
} from './dto/user-preferences.dto';
import { UserPreferencesService } from './user-preferences.service';
import { CurrentUser } from '@/auth/jwt/current-user.decorator';

@ApiTags('preferences')
@Controller('preferences')
export class UserPreferencesController {
    constructor(
        private readonly userPreferencesService: UserPreferencesService,
    ) {}

    @Get()
    @ApiOperation({ summary: 'Get synced app/UI preferences' })
    @ApiResponse({ status: 200, type: UserPreferencesResponseDto })
    async getPreferences(
        @CurrentUser() userLoginId: string,
    ): Promise<UserPreferencesResponseDto> {
        return this.userPreferencesService.getPreferences(userLoginId);
    }

    @Patch()
    @ApiOperation({
        summary: 'Merge a partial preferences patch (last-write-wins per key)',
    })
    @ApiResponse({ status: 200, type: UserPreferencesResponseDto })
    async updatePreferences(
        @CurrentUser() userLoginId: string,
        @Body() body: UpdateUserPreferencesDto,
    ): Promise<UserPreferencesResponseDto> {
        return this.userPreferencesService.updatePreferences(
            userLoginId,
            body.preferences,
        );
    }
}
