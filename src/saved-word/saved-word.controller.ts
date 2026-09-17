import {
    Body,
    Controller,
    Delete,
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
import { CurrentUser } from '@/auth/jwt/current-user.decorator';
import { WordScopeService } from '@/word-scope/word-scope.service';
import {
    ListSavedWordsDto,
    SaveWordDto,
    SavedWordsResponseDto,
} from './dto/saved-word.dto';
import { SavedWordService } from './saved-word.service';

@ApiTags('saved-words')
@Controller('saved-words')
export class SavedWordController {
    constructor(
        private readonly savedWordService: SavedWordService,
        private readonly wordScopeService: WordScopeService,
    ) {}

    @Post()
    @ApiOperation({
        summary: 'Flag a word as hard',
        description:
            'Idempotent — flagging an already-saved word just updates its note.',
    })
    @ApiBody({ type: SaveWordDto })
    async save(
        @CurrentUser() userLoginId: string,
        @Body() body: SaveWordDto,
    ): Promise<{ success: boolean }> {
        await this.savedWordService.save(userLoginId, body.wordId, body.note);
        return { success: true };
    }

    @Delete(':wordId')
    @ApiOperation({ summary: 'Unflag a word' })
    @ApiParam({
        name: 'wordId',
        description: 'Word ID',
        example: '01936b3e-7c8f-7890-abcd-ef1234567890',
    })
    async unsave(
        @CurrentUser() userLoginId: string,
        @Param('wordId', new ParseUUIDPipe()) wordId: string,
    ): Promise<{ success: boolean }> {
        await this.savedWordService.unsave(userLoginId, wordId);
        return { success: true };
    }

    /**
     * POST rather than GET because the scope can be a long id list — the same
     * reason the word-progress read endpoints are POSTs.
     */
    @Post('list')
    @ApiOperation({
        summary: 'List saved words',
        description:
            'Every saved word by default; pass wordIds, courseId or lessonId to narrow the scope.',
    })
    @ApiBody({ type: ListSavedWordsDto })
    @ApiResponse({ status: 200, type: SavedWordsResponseDto })
    async list(
        @CurrentUser() userLoginId: string,
        @Body() body: ListSavedWordsDto,
    ): Promise<SavedWordsResponseDto> {
        // An explicit list wins; a course/lesson is resolved against
        // vocabulary-service; none of the three means "all my saved words",
        // which is why this cannot reuse word-progress's resolveWordIds (that
        // one treats an absent list as an empty scope).
        let wordIds: string[] | undefined;
        if (body.wordIds) {
            wordIds = body.wordIds;
        } else if (body.courseId || body.lessonId) {
            wordIds = await this.wordScopeService.getScopedWordIds(
                body.courseId,
                body.lessonId,
            );
        }
        return this.savedWordService.list(userLoginId, wordIds);
    }
}
