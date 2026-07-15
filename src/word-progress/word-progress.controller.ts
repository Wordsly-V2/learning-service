import { InternalServiceGuard } from '@/guard/internal-service/internal-service.guard';
import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
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
import { WordProgressService } from './word-progress.service';

@ApiTags('users/:userLoginId/word-progress')
@Controller('users/:userLoginId/word-progress')
@ApiParam({
    name: 'userLoginId',
    description: 'User login ID',
    example: '01936c1e-1234-7890-abcd-ef1234567890',
})
@UseGuards(InternalServiceGuard)
export class WordProgressController {
    constructor(private readonly wordProgressService: WordProgressService) {}

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
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
        @Body() recordAnswerDto: RecordAnswerDto,
    ): Promise<WordProgressResponseDto> {
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
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
        @Body() body: BulkRecordAnswersDto,
    ): Promise<BulkRecordAnswersResponseDto> {
        return this.wordProgressService.recordAnswersBulk(
            userLoginId,
            body.answers,
            body.clientDate,
        );
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
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
        @Body() body: GetDueWordIdsDto,
    ): Promise<DueWordIdsResponseDto> {
        return this.wordProgressService.getDueWordIds(userLoginId, body);
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
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
        @Body() body: LeechWordIdsDto,
    ): Promise<LeechesResponseDto> {
        return this.wordProgressService.getLeeches(userLoginId, body.wordIds);
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
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
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
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
        @Body() body: StatsByScopesDto,
    ): Promise<Record<string, WordProgressStatsDto>> {
        const statsMap =
            await this.wordProgressService.getProgressStatsMapByScopes(
                userLoginId,
                body.scopes,
            );
        return Object.fromEntries(statsMap);
    }

    @Post('by-word-ids')
    @ApiOperation({
        summary: 'Get progress keyed by word ID',
    })
    @ApiBody({ type: ByWordIdsDto })
    async getProgressByWordIds(
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
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
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
        @Body() body: StatsByWordIdsDto,
    ): Promise<WordProgressStatsDto> {
        return this.wordProgressService.getProgressStats(
            userLoginId,
            body.wordIds,
        );
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
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
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
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
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
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
        @Param('wordId', new ParseUUIDPipe()) wordId: string,
    ): Promise<{ success: boolean }> {
        await this.wordProgressService.resetProgress(userLoginId, wordId);
        return { success: true };
    }
}
