import {
    Body,
    Controller,
    Get,
    HttpCode,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/auth/jwt/current-user.decorator';
import { ADMIN_ROLE, Roles } from '@/auth/jwt/roles.decorator';
import {
    ActivityCalendarQueryDto,
    ActivityCalendarResponseDto,
    LearningReportQueryDto,
    LearningReportResponseDto,
} from '@/learning-report/dto/learning-report.dto';
import { LearningReportService } from '@/learning-report/learning-report.service';
import { AdminLearningService } from './admin-learning.service';
import {
    HardestItemsQueryDto,
    type HardItem,
    type LearnerOverview,
    type LearnerSummary,
    type LearningStats,
    LearningStatsQueryDto,
    ResetProgressDto,
    type ResetResult,
    UsersSummaryDto,
} from './dto/admin-learning.dto';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Platform-wide learning stats and per-learner support under `/admin/learning`
 * (the gateway routes it here). Admins only; `:id` is the learner's
 * `UserLoginId`, which UserScopeGuard lets an admin name on these routes.
 */
@ApiTags('admin-learning')
@Roles(ADMIN_ROLE)
@Controller('admin/learning')
export class AdminLearningController {
    constructor(
        private readonly admin: AdminLearningService,
        private readonly reports: LearningReportService,
    ) {}

    @Get('stats')
    @ApiOperation({
        summary: 'Active learners, reviews, streaks, levels and retention',
    })
    stats(@Query() query: LearningStatsQueryDto): Promise<LearningStats> {
        return this.admin.stats(query.from, query.to);
    }

    @Post('users/summary')
    @HttpCode(200)
    @ApiOperation({
        summary: 'Last active, streak, level and cards for up to 100 learners',
    })
    summaries(@Body() body: UsersSummaryDto): Promise<LearnerSummary[]> {
        return this.admin.summaries(body.ids);
    }

    @Get('users/:id')
    @ApiOperation({ summary: "One learner's habit, level and cards" })
    overview(@Param('id', ParseUUIDPipe) id: string): Promise<LearnerOverview> {
        return this.admin.overview(id);
    }

    @Get('users/:id/report')
    @ApiOperation({ summary: 'The learning report, as that learner sees it' })
    report(
        @Param('id', ParseUUIDPipe) id: string,
        @Query() query: LearningReportQueryDto,
    ): Promise<LearningReportResponseDto> {
        return this.reports.getReport(
            id,
            query.period ?? 'week',
            query.clientDate ?? today(),
            query.offset ?? 0,
        );
    }

    @Get('users/:id/activity-calendar')
    @ApiOperation({ summary: 'That learner’s trailing 365 days of practice' })
    activityCalendar(
        @Param('id', ParseUUIDPipe) id: string,
        @Query() query: ActivityCalendarQueryDto,
    ): Promise<ActivityCalendarResponseDto> {
        return this.reports.getActivityCalendar(
            id,
            query.clientDate ?? today(),
        );
    }

    @Post('users/:id/reset')
    @HttpCode(200)
    @ApiOperation({
        summary: 'Clear cards, streak, XP or everything for one learner',
    })
    reset(
        @CurrentUser() actorId: string,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: ResetProgressDto,
    ): Promise<ResetResult> {
        return this.admin.reset(actorId, id, body.scope, body.source);
    }

    @Get('path-items/hardest')
    @ApiOperation({ summary: 'Wordsly Path items with the lowest accuracy' })
    hardest(@Query() query: HardestItemsQueryDto): Promise<HardItem[]> {
        return this.admin.hardestPathItems(query.limit, query.minLearners);
    }
}
