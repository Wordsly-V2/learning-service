import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
    BatchRecordDailyPracticeDto,
    DailyHabitQueryDto,
    DailyHabitResponseDto,
    RecordDailyPracticeDto,
    UpdateDailyGoalDto,
} from './dto/daily-habit.dto';
import { DailyHabitService } from './daily-habit.service';
import { CurrentUser } from '@/auth/jwt/current-user.decorator';

@ApiTags('daily-habit')
@Controller('daily-habit')
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
        @CurrentUser() userLoginId: string,
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
        @CurrentUser() userLoginId: string,
        @Body() body: RecordDailyPracticeDto,
    ): Promise<DailyHabitResponseDto> {
        return this.dailyHabitService.recordPractice(userLoginId, body);
    }

    @Post('record-practice/batch')
    @ApiOperation({
        summary: 'Record words practiced across several days',
        description:
            'For clients flushing sessions collected offline over more than one calendar day. Streaks are recomputed from the full day history, so a backdated day can fill a gap.',
    })
    @ApiBody({ type: BatchRecordDailyPracticeDto })
    @ApiResponse({
        status: 200,
        description: 'Practice recorded successfully',
        type: DailyHabitResponseDto,
    })
    async recordPracticeBatch(
        @CurrentUser() userLoginId: string,
        @Body() body: BatchRecordDailyPracticeDto,
    ): Promise<DailyHabitResponseDto> {
        return this.dailyHabitService.recordPracticeBatch(userLoginId, body);
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
        @CurrentUser() userLoginId: string,
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
