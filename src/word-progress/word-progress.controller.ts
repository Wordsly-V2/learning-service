import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
} from '@nestjs/common';
import {
    ApiBody,
    ApiOperation,
    ApiParam,
    ApiResponse,
    ApiTags,
} from '@nestjs/swagger';
import {
    BulkRecordAnswersDto,
    BulkRecordAnswersResponseDto,
    BulkResetProgressDto,
    ByWordIdsDto,
    DueWordIdsResponseDto,
    GetDueWordIdsDto,
    LeechesResponseDto,
    LeechWordIdsDto,
    RecordAnswerDto,
    StatsByScopesDto,
    StatsByWordIdsDto,
    WordProgressResponseDto,
    WordProgressStatsDto,
} from './dto/word-progress.dto';
import {
    StatsByCourseIdsDto,
    StatsByLessonIdsDto,
} from './dto/word-progress.dto';
import { WordScopeService } from '@/word-scope/word-scope.service';
import { WordProgressService } from './word-progress.service';
import { CurrentUser } from '@/auth/jwt/current-user.decorator';

@ApiTags('word-progress')
@Controller('word-progress')
export class WordProgressController {
    constructor(
        private readonly wordProgressService: WordProgressService,
        private readonly wordScopeService: WordScopeService,
    ) {}

    /**
     * The word ids a request applies to.
     *
     * Callers may either list the ids outright or name a course/lesson and have
     * the scope resolved from vocabulary-service. An explicit list always wins:
     * the offline client already holds its own word ids and must not have them
     * silently replaced by a server-side lookup.
     */
    private async resolveWordIds(body: {
        wordIds?: string[];
        courseId?: string;
        lessonId?: string;
    }): Promise<string[]> {
        if (body.wordIds) return body.wordIds;

        return this.wordScopeService.getScopedWordIds(
            body.courseId,
            body.lessonId,
        );
    }

    @Post('record-answer')
    @ApiOperation({
        summary: 'Record an answer for a word',
        description:
            "Records the user's answer quality and updates the spaced repetition schedule using FSRS",
    })
    @ApiBody({ type: RecordAnswerDto })
    @ApiResponse({
        status: 200,
        description: 'Answer recorded successfully',
        type: WordProgressResponseDto,
    })
    async recordAnswer(
        @CurrentUser() userLoginId: string,
        @Body() recordAnswerDto: RecordAnswerDto,
    ): Promise<WordProgressResponseDto> {
        // The id is spread in last and comes from the token. The DTO no longer
        // declares one, so a body that supplies it is stripped by the global
        // whitelisting ValidationPipe before this handler ever runs.
        return this.wordProgressService.recordAnswer({
            ...recordAnswerDto,
            userLoginId,
        });
    }

    @Post('record-answer/bulk-sync')
    @ApiOperation({
        summary: 'Record multiple answers synchronously',
        description:
            'Persists all answers in one transaction and returns updated progress rows.',
    })
    @ApiBody({ type: BulkRecordAnswersDto })
    @ApiResponse({
        status: 200,
        description: 'Answers recorded successfully',
        type: BulkRecordAnswersResponseDto,
    })
    async recordAnswersBulkSync(
        @CurrentUser() userLoginId: string,
        @Body() body: BulkRecordAnswersDto,
    ): Promise<BulkRecordAnswersResponseDto> {
        return this.wordProgressService.recordAnswersBulk(userLoginId, body);
    }

    @Post('due-word-ids')
    @ApiOperation({
        summary: 'Get IDs of words due for review',
        description:
            'Returns due word IDs within the provided wordIds scope. Due words first, then new words in caller order.',
    })
    @ApiBody({ type: GetDueWordIdsDto })
    @ApiResponse({
        status: 200,
        description: 'Due word IDs retrieved successfully',
        type: DueWordIdsResponseDto,
    })
    async getDueWordIds(
        @CurrentUser() userLoginId: string,
        @Body() body: GetDueWordIdsDto,
    ): Promise<DueWordIdsResponseDto> {
        const wordIds = await this.resolveWordIds(body);
        return this.wordProgressService.getDueWordIds(userLoginId, {
            ...body,
            wordIds,
        });
    }

    @Post('leeches')
    @ApiOperation({
        summary: 'Get leech cards within a scope',
        description:
            'Returns cards flagged as leeches (lapsed past the threshold), most-lapsed first.',
    })
    @ApiBody({ type: LeechWordIdsDto })
    @ApiResponse({ status: 200, type: LeechesResponseDto })
    async getLeeches(
        @CurrentUser() userLoginId: string,
        @Body() body: LeechWordIdsDto,
    ): Promise<LeechesResponseDto> {
        const wordIds = await this.resolveWordIds(body);
        return this.wordProgressService.getLeeches(userLoginId, wordIds);
    }

    @Post('words/:wordId/unsuspend')
    @ApiOperation({
        summary: 'Unsuspend a card so it re-enters review selection',
    })
    @ApiParam({
        name: 'wordId',
        description: 'Word ID',
        example: '01936b3e-7c8f-7890-abcd-ef1234567890',
    })
    async unsuspendWord(
        @CurrentUser() userLoginId: string,
        @Param('wordId', new ParseUUIDPipe()) wordId: string,
    ): Promise<{ success: boolean }> {
        await this.wordProgressService.unsuspendWord(userLoginId, wordId);
        return { success: true };
    }

    @Post('stats/by-scopes')
    @ApiOperation({
        summary: 'Get progress stats keyed by scope ID',
        description:
            'Batch endpoint: each scope provides scopeId + wordIds. Caller resolves vocabulary ownership.',
    })
    @ApiBody({ type: StatsByScopesDto })
    async getProgressStatsByScopes(
        @CurrentUser() userLoginId: string,
        @Body() body: StatsByScopesDto,
    ): Promise<Record<string, WordProgressStatsDto>> {
        const statsMap =
            await this.wordProgressService.getProgressStatsMapByScopes(
                userLoginId,
                body.scopes,
            );
        return Object.fromEntries(statsMap);
    }

    @Post('stats/by-course-ids')
    @ApiOperation({
        summary: 'Get progress stats keyed by course ID',
        description:
            'Resolves each course to its word IDs, then computes stats per course in one pass.',
    })
    @ApiBody({ type: StatsByCourseIdsDto })
    async getProgressStatsByCourseIds(
        @CurrentUser() userLoginId: string,
        @Body() body: StatsByCourseIdsDto,
    ): Promise<Record<string, WordProgressStatsDto>> {
        const grouped = await this.wordScopeService.groupByCourseIds(
            body.courseIds,
        );
        const statsMap =
            await this.wordProgressService.getProgressStatsMapByScopes(
                userLoginId,
                this.wordScopeService.toScopes(body.courseIds, grouped),
            );
        return Object.fromEntries(statsMap);
    }

    @Post('stats/by-lesson-ids')
    @ApiOperation({
        summary: 'Get progress stats keyed by lesson ID',
        description:
            'Resolves each lesson to its word IDs, then computes stats per lesson in one pass.',
    })
    @ApiBody({ type: StatsByLessonIdsDto })
    async getProgressStatsByLessonIds(
        @CurrentUser() userLoginId: string,
        @Body() body: StatsByLessonIdsDto,
    ): Promise<Record<string, WordProgressStatsDto>> {
        const grouped = await this.wordScopeService.groupByLessonIds(
            body.lessonIds,
        );
        const statsMap =
            await this.wordProgressService.getProgressStatsMapByScopes(
                userLoginId,
                this.wordScopeService.toScopes(body.lessonIds, grouped),
            );
        return Object.fromEntries(statsMap);
    }

    @Post('by-word-ids')
    @ApiOperation({
        summary: 'Get progress keyed by word ID',
    })
    @ApiBody({ type: ByWordIdsDto })
    async getProgressByWordIds(
        @CurrentUser() userLoginId: string,
        @Body() body: ByWordIdsDto,
    ): Promise<Record<string, WordProgressResponseDto | null>> {
        const progressMap =
            await this.wordProgressService.getProgressMapByWordIds(
                userLoginId,
                body.wordIds,
            );
        return Object.fromEntries(progressMap);
    }

    @Post('stats')
    @ApiOperation({
        summary: 'Get learning progress statistics for word IDs',
    })
    @ApiBody({ type: StatsByWordIdsDto })
    @ApiResponse({
        status: 200,
        description: 'Statistics retrieved successfully',
        type: WordProgressStatsDto,
    })
    async getProgressStats(
        @CurrentUser() userLoginId: string,
        @Body() body: StatsByWordIdsDto,
    ): Promise<WordProgressStatsDto> {
        const wordIds = await this.resolveWordIds(body);
        return this.wordProgressService.getProgressStats(userLoginId, wordIds);
    }

    @Get('words/:wordId')
    @ApiOperation({
        summary: 'Get progress for a specific word',
    })
    @ApiParam({
        name: 'wordId',
        description: 'Word ID',
        example: '01936b3e-7c8f-7890-abcd-ef1234567890',
    })
    @ApiResponse({
        status: 200,
        description: 'Word progress retrieved successfully',
        type: WordProgressResponseDto,
    })
    async getWordProgress(
        @CurrentUser() userLoginId: string,
        @Param('wordId') wordId: string,
    ): Promise<WordProgressResponseDto | null> {
        return this.wordProgressService.getWordProgress(userLoginId, wordId);
    }

    @Delete('words/bulk-reset')
    @ApiOperation({
        summary: 'Reset progress for multiple words',
    })
    @ApiBody({ type: BulkResetProgressDto })
    async resetProgressBulk(
        @CurrentUser() userLoginId: string,
        @Body() body: BulkResetProgressDto,
    ): Promise<{ count: number }> {
        return this.wordProgressService.resetProgressBulk(
            userLoginId,
            body.wordIds,
        );
    }

    @Delete('words/:wordId/reset')
    @ApiOperation({
        summary: 'Reset progress for a specific word',
    })
    @ApiParam({
        name: 'wordId',
        description: 'Word ID',
        example: '01936b3e-7c8f-7890-abcd-ef1234567890',
    })
    async resetProgress(
        @CurrentUser() userLoginId: string,
        @Param('wordId', new ParseUUIDPipe()) wordId: string,
    ): Promise<{ success: boolean }> {
        await this.wordProgressService.resetProgress(userLoginId, wordId);
        return { success: true };
    }
}
