import { InternalServiceGuard } from '@/guard/internal-service/internal-service.guard';
import {
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserLevelResponseDto } from './dto/user-level.dto';
import { UserLevelService } from './user-level.service';

@ApiTags('users/:userLoginId/level')
@Controller('users/:userLoginId/level')
@ApiParam({
    name: 'userLoginId',
    description: 'User login ID',
    example: '01936c1e-1234-7890-abcd-ef1234567890',
})
@UseGuards(InternalServiceGuard)
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
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
    ): Promise<UserLevelResponseDto> {
        return this.userLevelService.getUserLevel(userLoginId);
    }
}
