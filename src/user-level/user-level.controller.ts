import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserLevelResponseDto } from './dto/user-level.dto';
import { UserLevelService } from './user-level.service';
import { CurrentUser } from '@/auth/jwt/current-user.decorator';

@ApiTags('level')
@Controller('level')
export class UserLevelController {
    constructor(private readonly userLevelService: UserLevelService) {}

    @Get()
    @ApiOperation({
        summary: 'Get user learning level',
        description:
            'Returns the current numeric level, rank, and XP progress toward the next level.',
    })
    @ApiResponse({
        status: 200,
        description: 'User level retrieved successfully',
        type: UserLevelResponseDto,
    })
    async getUserLevel(
        @CurrentUser() userLoginId: string,
    ): Promise<UserLevelResponseDto> {
        return this.userLevelService.getUserLevel(userLoginId);
    }
}
