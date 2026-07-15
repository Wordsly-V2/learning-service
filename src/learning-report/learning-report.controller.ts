import { InternalServiceGuard } from '@/guard/internal-service/internal-service.guard';
import {
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
    ActivityCalendarQueryDto,
    ActivityCalendarResponseDto,
    LearningReportQueryDto,
    LearningReportResponseDto,
    ReviewForecastQueryDto,
    ReviewForecastResponseDto,
} from './dto/learning-report.dto';
import { LearningReportService } from './learning-report.service';

@ApiTags('users/:userLoginId/learning-report')
@Controller('users/:userLoginId/learning-report')
@ApiParam({
    name: 'userLoginId',
    description: 'User login ID',
    example: '01936c1e-1234-7890-abcd-ef1234567890',
})
@UseGuards(InternalServiceGuard)
export class LearningReportController {
    constructor(
        private readonly learningReportService: LearningReportService,
    ) {}

    @Get()
    @ApiOperation({
        summary: 'Get the learning progress report',
        description:
            'Time-bucketed words/accuracy/consistency trends, a mastery snapshot, streaks and achievements for the chosen period (week/month/year).',
    })
    @ApiResponse({
        status: 200,
        description: 'Report generated successfully',
        type: LearningReportResponseDto,
    })
    getReport(
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
        @Query() query: LearningReportQueryDto,
    ): Promise<LearningReportResponseDto> {
        const period = query.period ?? 'week';
        const clientDate =
            query.clientDate ?? new Date().toISOString().slice(0, 10);
        return this.learningReportService.getReport(
            userLoginId,
            period,
            clientDate,
        );
    }

    @Get('forecast')
    @ApiOperation({
        summary: 'Upcoming review workload forecast',
        description: 'Per-day count of reviews due over the next 7 or 30 days.',
    })
    @ApiResponse({ status: 200, type: ReviewForecastResponseDto })
    getForecast(
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
        @Query() query: ReviewForecastQueryDto,
    ): Promise<ReviewForecastResponseDto> {
        const days = query.days ?? 7;
        const clientDate =
            query.clientDate ?? new Date().toISOString().slice(0, 10);
        return this.learningReportService.getReviewForecast(
            userLoginId,
            days,
            clientDate,
        );
    }

    @Get('activity-calendar')
    @ApiOperation({
        summary: 'Trailing 365-day practice activity for a heatmap',
    })
    @ApiResponse({ status: 200, type: ActivityCalendarResponseDto })
    getActivityCalendar(
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
        @Query() query: ActivityCalendarQueryDto,
    ): Promise<ActivityCalendarResponseDto> {
        const clientDate =
            query.clientDate ?? new Date().toISOString().slice(0, 10);
        return this.learningReportService.getActivityCalendar(
            userLoginId,
            clientDate,
        );
    }
}
