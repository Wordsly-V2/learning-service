import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsBoolean,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    ValidateBy,
    ValidateNested,
    ValidationOptions,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsPushEndpoint } from '../push-endpoint';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Whether `value` is a time zone Intl can resolve. The reminder scheduler feeds
 * the stored zone straight into Intl.DateTimeFormat, which throws a RangeError
 * on an unknown one — so a bad value saved here would break that user's
 * reminders on every tick instead of being refused once, at the door.
 */
export function isIanaTimeZone(value: unknown): boolean {
    if (typeof value !== 'string' || value.length === 0) {
        return false;
    }
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
    } catch {
        return false;
    }
}

function IsIanaTimeZone(options?: ValidationOptions): PropertyDecorator {
    return ValidateBy(
        {
            name: 'isIanaTimeZone',
            validator: {
                validate: (value) => isIanaTimeZone(value),
                defaultMessage: () =>
                    'timezone must be an IANA time zone, e.g. Asia/Ho_Chi_Minh',
            },
        },
        options,
    );
}

export class PushSubscriptionKeysDto {
    @ApiProperty({ description: 'p256dh key' })
    @IsString()
    p256dh: string;

    @ApiProperty({ description: 'auth secret' })
    @IsString()
    auth: string;
}

export class SubscribeDto {
    @ApiProperty({ description: 'Push endpoint URL' })
    @IsString()
    @IsPushEndpoint()
    endpoint: string;

    @ApiProperty({ type: PushSubscriptionKeysDto })
    @ValidateNested()
    @Type(() => PushSubscriptionKeysDto)
    keys: PushSubscriptionKeysDto;

    @ApiPropertyOptional({ description: 'User agent string' })
    @IsOptional()
    @IsString()
    userAgent?: string;
}

export class UnsubscribeDto {
    @ApiProperty({ description: 'Push endpoint URL to remove' })
    @IsString()
    endpoint: string;
}

export class UpdatePreferencesDto {
    @ApiPropertyOptional({ description: 'Enable streak reminders' })
    @IsOptional()
    @IsBoolean()
    streakReminderEnabled?: boolean;

    @ApiPropertyOptional({ description: 'Reminder time HH:mm (user-local)' })
    @IsOptional()
    @IsString()
    @Matches(TIME_PATTERN)
    reminderTime?: string;

    @ApiPropertyOptional({
        description: 'IANA timezone, e.g. Asia/Ho_Chi_Minh',
    })
    @IsOptional()
    @IsString()
    @MaxLength(64)
    @IsIanaTimeZone()
    timezone?: string;
}

export class NotificationPreferencesResponseDto {
    @ApiProperty({ example: false })
    streakReminderEnabled: boolean;

    @ApiProperty({ example: '19:00' })
    reminderTime: string;

    @ApiProperty({ example: 'Asia/Ho_Chi_Minh' })
    timezone: string;

    @ApiProperty({ example: true })
    hasSubscription: boolean;
}
