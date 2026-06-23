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
    LearningReportQueryDto,
    LearningReportResponseDto,
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
}
