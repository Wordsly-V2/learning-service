import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    ArrayMaxSize,
    IsArray,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
} from 'class-validator';
import { MAX_ID_LIST } from '@/word-progress/dto/word-progress.dto';

/** Long enough for a reminder to yourself, short enough not to be a document. */
export const MAX_SAVED_WORD_NOTE = 500;

export class SaveWordDto {
    @ApiProperty({
        description: 'The word to flag as hard',
        example: '01936b3e-7c8f-7890-abcd-ef1234567890',
    })
    @IsUUID()
    wordId: string;

    @ApiPropertyOptional({
        description: "Why it is hard, in the learner's own words",
        example: 'keeps getting mixed up with "affect"',
        maxLength: MAX_SAVED_WORD_NOTE,
    })
    @IsOptional()
    @IsString()
    @MaxLength(MAX_SAVED_WORD_NOTE)
    note?: string;
}

/**
 * Scope for a list request. Same three-way shape as the leech listing: an
 * explicit id list wins, otherwise the scope is resolved from a course or
 * lesson, otherwise it is every saved word the learner has.
 */
export class ListSavedWordsDto {
    @ApiPropertyOptional({
        description:
            'Restrict to these word IDs. Omit all three fields to list every saved word.',
        type: [String],
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(MAX_ID_LIST)
    @IsUUID(undefined, { each: true })
    wordIds?: string[];

    @ApiPropertyOptional({ description: 'Resolve the scope from a course.' })
    @IsOptional()
    @IsUUID()
    courseId?: string;

    @ApiPropertyOptional({ description: 'Resolve the scope from a lesson.' })
    @IsOptional()
    @IsUUID()
    lessonId?: string;
}

export class SavedWordItemDto {
    @ApiProperty({
        description: 'Word ID',
        example: '01936b3e-7c8f-7890-abcd-ef1234567890',
    })
    wordId: string;

    @ApiPropertyOptional({ description: 'The learner’s note, if any' })
    note?: string;

    @ApiProperty({ description: 'When it was flagged' })
    savedAt: Date;

    @ApiPropertyOptional({
        description:
            'Next scheduled review, or null when the word has never been practised.',
    })
    nextReviewAt?: Date | null;

    @ApiProperty({
        description:
            'Percentage of reviews answered correctly (0 with no reviews)',
        example: 62.5,
    })
    successRate: number;

    @ApiProperty({ description: 'Reviews recorded so far', example: 8 })
    totalReviews: number;

    @ApiProperty({
        description:
            'Whether the scheduler ALSO flags this word as a leech. The two are independent: this list is what the learner chose, `isLeech` is what the algorithm noticed.',
        example: false,
    })
    isLeech: boolean;

    @ApiProperty({
        description:
            'True once the word is a settled Review-state card on a run of correct answers — the same bar a leech has to clear to be rescued. The word is never un-saved automatically; this only lets the UI offer it.',
        example: false,
    })
    isSettled: boolean;
}

export class SavedWordsResponseDto {
    @ApiProperty({
        description: 'Saved words, most recently flagged first',
        type: [SavedWordItemDto],
    })
    savedWords: SavedWordItemDto[];
}
