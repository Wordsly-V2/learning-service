import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
    IsArray,
    IsBoolean,
    IsEnum,
    IsInt,
    IsOptional,
    IsUUID,
    Max,
    Min,
    ArrayMaxSize,
    ValidateNested,
} from 'class-validator';

/**
 * Quality rating for spaced repetition (FSRS / SM-2 compatible scale)
 * 0 = complete blackout
 * 1 = incorrect response, correct answer remembered
 * 2 = incorrect response, correct answer seemed easy to recall
 * 3 = correct response recalled with serious difficulty
 * 4 = correct response after hesitation
 * 5 = perfect response
 */
export enum AnswerQuality {
    COMPLETE_BLACKOUT = 0,
    INCORRECT = 1,
    INCORRECT_BUT_EASY = 2,
    CORRECT_WITH_DIFFICULTY = 3,
    CORRECT_WITH_HESITATION = 4,
    PERFECT = 5,
}

export class RecordAnswerDto {
    @ApiProperty({
        description: 'The login ID of the user',
        example: '01936b3e-7c8f-7890-abcd-ef1234567890',
    })
    @IsUUID()
    userLoginId: string;

    @ApiProperty({
        description: 'The ID of the word being reviewed',
        example: '01936b3e-7c8f-7890-abcd-ef1234567890',
    })
    @IsUUID()
    wordId: string;

    @ApiProperty({
        description: 'Quality of the answer (0-5)',
        enum: AnswerQuality,
        example: 4,
    })
    @IsEnum(AnswerQuality)
    quality: AnswerQuality;
}

export class BulkAnswerItemDto {
    @ApiProperty({
        description: 'The ID of the word being reviewed',
        example: '01936b3e-7c8f-7890-abcd-ef1234567890',
    })
    @IsUUID()
    wordId: string;

    @ApiProperty({
        description: 'Quality of the answer (0-5)',
        enum: AnswerQuality,
        example: 4,
    })
    @IsEnum(AnswerQuality)
    quality: AnswerQuality;
}

/** Max answers per bulk practice session save. */
export const MAX_BULK_ANSWERS = 200;

export class BulkRecordAnswersDto {
    @ApiProperty({
        description: 'Array of word answers to record',
        type: [BulkAnswerItemDto],
    })
    @IsArray()
    @ArrayMaxSize(MAX_BULK_ANSWERS)
    @ValidateNested({ each: true })
    @Type(() => BulkAnswerItemDto)
    answers: BulkAnswerItemDto[];
}

export class GetDueWordIdsDto {
    @ApiProperty({
        description: 'Word IDs in scope (caller-defined order for new words)',
        type: [String],
    })
    @IsArray()
    @IsUUID(undefined, { each: true })
    wordIds: string[];

    @ApiPropertyOptional({
        description: 'Maximum number of words to return',
        example: 20,
        default: 20,
        minimum: 1,
        maximum: 100,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number = 20;

    @ApiPropertyOptional({
        description: 'Include new words (not yet reviewed)',
        example: true,
        default: true,
    })
    @IsOptional()
    @Transform(({ value }) => {
        if (value === 'true' || value === true) return true;
        if (value === 'false' || value === false) return false;
        return true;
    })
    @IsBoolean()
    includeNew?: boolean = true;
}

export class WordProgressResponseDto {
    @ApiProperty({
        description: 'Word progress ID',
        example: '01936b3e-7c8f-7890-abcd-ef1234567890',
    })
    id: string;

    @ApiProperty({
        description: 'Word ID',
        example: '01936b3e-7c8f-7890-abcd-ef1234567890',
    })
    wordId: string;

    @ApiProperty({
        description: 'User login ID',
        example: '01936b3e-7c8f-7890-abcd-ef1234567890',
    })
    userLoginId: string;

    @ApiProperty({
        description: 'Ease factor (difficulty)',
        example: 2.5,
    })
    easeFactor: number;

    @ApiProperty({
        description: 'Interval in days until next review',
        example: 3,
    })
    interval: number;

    @ApiProperty({
        description: 'Number of consecutive correct answers',
        example: 2,
    })
    repetitions: number;

    @ApiPropertyOptional({
        description: 'Last review date',
        example: '2026-02-06T09:15:44.000Z',
    })
    lastReviewedAt?: Date;

    @ApiProperty({
        description: 'Next review date',
        example: '2026-02-09T09:15:44.000Z',
    })
    nextReviewAt: Date;

    @ApiProperty({
        description: 'Total number of reviews',
        example: 5,
    })
    totalReviews: number;

    @ApiProperty({
        description: 'Number of correct reviews',
        example: 4,
    })
    correctReviews: number;

    @ApiProperty({
        description: 'Success rate percentage',
        example: 80,
    })
    successRate: number;
}

export class DueWordDto extends WordProgressResponseDto {
    @ApiProperty({
        description: 'Word details',
    })
    word: {
        id: string;
        word: string;
        meaning: string;
        pronunciation?: string;
        partOfSpeech?: string;
        audioUrl?: string;
        lessonId: string;
    };

    @ApiProperty({
        description: 'Whether this is a new word (not yet reviewed)',
        example: false,
    })
    isNew: boolean;
}

export class DueWordIdsResponseDto {
    @ApiProperty({
        description:
            'List of word IDs that are due for review (same order as due-words API)',
        type: [String],
        example: [
            '01936b3e-7c8f-7890-abcd-ef1234567890',
            '01936b3e-7c8f-7890-abcd-ef1234567891',
        ],
    })
    wordIds: string[];
}

export class WordProgressStatsDto {
    @ApiProperty({
        description: 'Total words in learning',
        example: 150,
    })
    totalWords: number;

    @ApiProperty({
        description: 'New words not yet reviewed',
        example: 30,
    })
    newWords: number;

    @ApiProperty({
        description: 'Words currently in learning phase',
        example: 45,
    })
    learningWords: number;

    @ApiProperty({
        description: 'Words in review phase',
        example: 75,
    })
    reviewWords: number;

    @ApiProperty({
        description: 'Words due for review today',
        example: 20,
    })
    dueToday: number;

    @ApiProperty({
        description: 'Overall success rate percentage',
        example: 85.5,
    })
    overallSuccessRate: number;
}

export class ResetProgressDto {
    @ApiProperty({
        description: 'The ID of the word to reset progress for',
        example: '01936b3e-7c8f-7890-abcd-ef1234567890',
    })
    @IsUUID()
    wordId: string;
}

export class BulkResetProgressDto {
    @ApiProperty({
        description: 'Array of word IDs to reset progress for',
        example: [
            '01936b3e-7c8f-7890-abcd-ef1234567890',
            '01936b3e-7c8f-7890-abcd-ef1234567891',
        ],
        type: [String],
    })
    @IsArray()
    @IsUUID(undefined, { each: true })
    wordIds: string[];
}

export class StatsByWordIdsDto {
    @ApiProperty({
        description: 'Word IDs to compute progress stats for',
        type: [String],
    })
    @IsArray()
    @IsUUID(undefined, { each: true })
    wordIds: string[];
}

export class ScopeWordIdsDto {
    @ApiProperty({
        description: 'Scope identifier (e.g. course ID or lesson ID)',
        example: '01936b3e-7c8f-7890-abcd-ef1234567890',
    })
    @IsUUID()
    scopeId: string;

    @ApiProperty({
        description: 'Word IDs belonging to this scope',
        type: [String],
    })
    @IsArray()
    @IsUUID(undefined, { each: true })
    wordIds: string[];
}

export class StatsByScopesDto {
    @ApiProperty({
        description: 'Scopes with their word IDs',
        type: [ScopeWordIdsDto],
    })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ScopeWordIdsDto)
    scopes: ScopeWordIdsDto[];
}

export class ByWordIdsDto {
    @ApiProperty({
        description: 'Word IDs to fetch progress for',
        type: [String],
    })
    @IsArray()
    @IsUUID(undefined, { each: true })
    wordIds: string[];
}
