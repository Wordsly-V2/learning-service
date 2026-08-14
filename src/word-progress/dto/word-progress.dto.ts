import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LevelEventDto } from '@/user-level/dto/user-level.dto';
import { Transform, Type } from 'class-transformer';
import {
    IsArray,
    IsBoolean,
    IsEnum,
    IsInt,
    IsISO8601,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    Max,
    Min,
    ArrayMaxSize,
    ValidateNested,
} from 'class-validator';

/** Client local calendar date format shared with the daily-habit module. */
export const CLIENT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Quality rating for spaced repetition (mapped to FSRS grades)
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

    @ApiPropertyOptional({
        description:
            'Client local calendar date (YYYY-MM-DD) the review happened on. Defaults to the server date when omitted.',
        example: '2026-06-05',
    })
    @IsOptional()
    @IsString()
    @Matches(CLIENT_DATE_PATTERN)
    clientDate?: string;
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

    @ApiPropertyOptional({
        description:
            'ISO-8601 instant the user actually answered. Offline clients send the real answer time so FSRS schedules from when the review happened rather than from sync time. Defaults to server receipt time; clamped server-side (see MAX_BACKDATE_DAYS / MAX_FUTURE_SKEW_MS).',
        example: '2026-08-11T14:03:22.117Z',
    })
    @IsOptional()
    @IsISO8601({ strict: true })
    reviewedAt?: string;
}

/** Max answers per bulk practice session save. */
export const MAX_BULK_ANSWERS = 500;

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

    @ApiPropertyOptional({
        description:
            "Client local calendar date (YYYY-MM-DD) for the client's TODAY. Defaults to the server date when omitted.",
        example: '2026-06-05',
    })
    @IsOptional()
    @IsString()
    @Matches(CLIENT_DATE_PATTERN)
    clientDate?: string;

    @ApiPropertyOptional({
        description:
            "Minutes to ADD to a UTC instant to get the user's local wall-clock time (i.e. -getTimezoneOffset()). Used to derive each answer's local calendar date from its reviewedAt. Falls back to clientDate when omitted.",
        example: 420,
        minimum: -840,
        maximum: 840,
    })
    @IsOptional()
    @IsInt()
    @Min(-840)
    @Max(840)
    tzOffsetMinutes?: number;

    @ApiPropertyOptional({
        description:
            'Client-generated UUID identifying this flush. Replaying the same id returns the original response without re-applying XP or FSRS.',
        example: '01936b3e-7c8f-7890-abcd-ef1234567890',
    })
    @IsOptional()
    @IsUUID()
    clientRequestId?: string;
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
        description:
            'Maximum number of NEW (never-studied) words to include, independent of the due/review cap. When omitted, new words fill whatever room the combined `limit` leaves after due words (legacy behaviour).',
        example: 5,
        minimum: 0,
        maximum: 100,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(100)
    newLimit?: number;

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

    @ApiPropertyOptional({
        description:
            'Client local calendar date (YYYY-MM-DD) used to count today’s new words/reviews against the daily pacing limits. Defaults to the server date.',
        example: '2026-06-05',
    })
    @IsOptional()
    @IsString()
    @Matches(CLIENT_DATE_PATTERN)
    clientDate?: string;
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

    @ApiPropertyOptional({
        description: 'FSRS state: 0=New 1=Learning 2=Review 3=Relearning',
        example: 2,
    })
    state?: number;

    @ApiPropertyOptional({
        description: 'Times the card has lapsed (Again on a Review card)',
        example: 1,
    })
    lapses?: number;

    @ApiPropertyOptional({
        description: 'Whether this card has lapsed past the leech threshold',
        example: false,
    })
    isLeech?: boolean;

    @ApiPropertyOptional({
        description:
            'When the card was suspended (withheld from reviews), if any',
        example: '2026-02-06T09:15:44.000Z',
    })
    suspendedAt?: Date | null;

    @ApiPropertyOptional({
        description:
            'XP/level result of recording this answer (single-answer endpoint only). Present when XP was awarded so the client can show a level-up.',
        type: LevelEventDto,
    })
    levelEvent?: LevelEventDto;
}

export class BulkRecordAnswersResponseDto {
    @ApiProperty({
        description: 'Per-word progress after recording the session',
        type: [WordProgressResponseDto],
    })
    results: WordProgressResponseDto[];

    @ApiPropertyOptional({
        description:
            'XP/level result for the whole session so the client can celebrate a level-up.',
        type: LevelEventDto,
    })
    levelEvent?: LevelEventDto;

    @ApiProperty({
        description: 'Streak XP multiplier applied to this session (1 = none)',
        example: 1.25,
    })
    xpMultiplier: number;

    @ApiPropertyOptional({
        description:
            'True when this response was replayed from the idempotency ledger — nothing was applied, so the client must not re-animate XP.',
        example: false,
    })
    replayed?: boolean;
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

export class PacingInfoDto {
    @ApiProperty({ description: 'New words still allowed today', example: 5 })
    newWordsRemainingToday: number;

    @ApiProperty({ description: 'Reviews still allowed today', example: 80 })
    reviewsRemainingToday: number;

    @ApiProperty({
        description: 'Configured daily new-word limit',
        example: 10,
    })
    dailyNewWordLimit: number;

    @ApiProperty({ description: 'Configured daily review limit', example: 100 })
    dailyReviewLimit: number;
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

    @ApiPropertyOptional({
        description: 'Remaining daily pacing budget after this request',
        type: PacingInfoDto,
    })
    pacing?: PacingInfoDto;
}

export class LeechWordIdsDto {
    @ApiProperty({
        description: 'Word IDs in scope to check for leeches',
        type: [String],
    })
    @IsArray()
    @IsUUID(undefined, { each: true })
    wordIds: string[];
}

export class LeechItemDto {
    @ApiProperty({
        description: 'Word ID',
        example: '01936b3e-7c8f-7890-abcd-ef1234567890',
    })
    wordId: string;

    @ApiProperty({ description: 'Times the card has lapsed', example: 9 })
    lapses: number;

    @ApiProperty({ description: 'FSRS state', example: 3 })
    state: number;

    @ApiProperty({ description: 'Total reviews', example: 20 })
    totalReviews: number;

    @ApiProperty({ description: 'Correct reviews', example: 8 })
    correctReviews: number;

    @ApiProperty({ description: 'Success rate percentage', example: 40 })
    successRate: number;

    @ApiPropertyOptional({ description: 'When suspended, if suspended' })
    suspendedAt?: Date | null;

    @ApiProperty({ description: 'Next review date' })
    nextReviewAt: Date;
}

export class LeechesResponseDto {
    @ApiProperty({
        description: 'Leech cards, most-lapsed first',
        type: [LeechItemDto],
    })
    leeches: LeechItemDto[];
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
