import { InternalServiceGuard } from '@/guard/internal-service/internal-service.guard';
import {
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBody,
    ApiOperation,
    ApiParam,
    ApiResponse,
    ApiTags,
} from '@nestjs/swagger';
import {
    DailyHabitQueryDto,
    DailyHabitResponseDto,
    RecordDailyPracticeDto,
    UpdateDailyGoalDto,
} from './dto/daily-habit.dto';
import { DailyHabitService } from './daily-habit.service';

@ApiTags('users/:userLoginId/daily-habit')
@Controller('users/:userLoginId/daily-habit')
@ApiParam({
    name: 'userLoginId',
    description: 'User login ID',
    example: '01936c1e-1234-7890-abcd-ef1234567890',
})
@UseGuards(InternalServiceGuard)
export class DailyHabitController {
    constructor(private readonly dailyHabitService: DailyHabitService) {}

    @Get()
    @ApiOperation({
        summary: 'Get daily habit state',
        description:
            'Returns words practiced today, streak, and goal progress for the client calendar date.',
    })
    @ApiResponse({
        status: 200,
        description: 'Daily habit retrieved successfully',
        type: DailyHabitResponseDto,
    })
    async getDailyHabit(
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
        @Query() query: DailyHabitQueryDto,
    ): Promise<DailyHabitResponseDto> {
        const clientDate =
            query.clientDate ?? new Date().toISOString().slice(0, 10);
        return this.dailyHabitService.getDailyHabit(userLoginId, clientDate);
    }

    @Post('record-practice')
    @ApiOperation({
        summary: 'Record words practiced',
        description:
            'Increments today’s word count and updates the practice streak.',
    })
    @ApiBody({ type: RecordDailyPracticeDto })
    @ApiResponse({
        status: 200,
        description: 'Practice recorded successfully',
        type: DailyHabitResponseDto,
    })
    async recordPractice(
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
        @Body() body: RecordDailyPracticeDto,
    ): Promise<DailyHabitResponseDto> {
        return this.dailyHabitService.recordPractice(userLoginId, body);
    }

    @Patch('goal')
    @ApiOperation({
        summary: 'Update daily word goal',
    })
    @ApiBody({ type: UpdateDailyGoalDto })
    @ApiResponse({
        status: 200,
        description: 'Daily goal updated successfully',
        type: DailyHabitResponseDto,
    })
    async updateDailyGoal(
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
        @Body() body: UpdateDailyGoalDto,
        @Query() query: DailyHabitQueryDto,
    ): Promise<DailyHabitResponseDto> {
        const clientDate =
            query.clientDate ?? new Date().toISOString().slice(0, 10);
        return this.dailyHabitService.updateDailyGoal(
            userLoginId,
            body,
            clientDate,
        );
    }
}
