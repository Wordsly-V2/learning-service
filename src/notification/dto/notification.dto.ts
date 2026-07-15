import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsBoolean,
    IsOptional,
    IsString,
    Matches,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

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
