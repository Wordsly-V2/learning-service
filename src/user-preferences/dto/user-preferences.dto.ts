import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

/**
 * The preferences blob is opaque to this service — its shape is owned by the
 * frontend. We only ever store, shallow-merge and return it, so validation is
 * limited to "is a JSON object".
 */
export type PreferencesBlob = Record<string, unknown>;

export class UserPreferencesResponseDto {
    @ApiProperty({
        description: 'Opaque per-user preferences blob (shape owned by client)',
        example: { practice: { mode: 'mixed' }, dueWordsLimit: 20 },
        type: 'object',
        additionalProperties: true,
    })
    preferences: PreferencesBlob;
}

export class UpdateUserPreferencesDto {
    @ApiProperty({
        description:
            'Partial preferences to shallow-merge into the stored blob (last-write-wins per key)',
        example: { dueWordsLimit: 10 },
        type: 'object',
        additionalProperties: true,
    })
    @IsObject()
    preferences: PreferencesBlob;
}
