import { InternalServiceGuard } from '@/guard/internal-service/internal-service.guard';
import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
    NotificationPreferencesResponseDto,
    SubscribeDto,
    UnsubscribeDto,
    UpdatePreferencesDto,
} from './dto/notification.dto';
import { NotificationService } from './notification.service';
import { PushSenderService } from './push-sender.service';

@ApiTags('users/:userLoginId/notifications')
@Controller('users/:userLoginId/notifications')
@ApiParam({ name: 'userLoginId', description: 'User login ID' })
@UseGuards(InternalServiceGuard)
export class NotificationController {
    constructor(private readonly notificationService: NotificationService) {}

    @Post('subscriptions')
    @ApiOperation({ summary: 'Register a web push subscription' })
    async subscribe(
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
        @Body() body: SubscribeDto,
    ): Promise<{ success: boolean }> {
        await this.notificationService.subscribe(userLoginId, body);
        return { success: true };
    }

    @Delete('subscriptions')
    @ApiOperation({ summary: 'Remove a web push subscription' })
    async unsubscribe(
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
        @Body() body: UnsubscribeDto,
    ): Promise<{ success: boolean }> {
        await this.notificationService.unsubscribe(userLoginId, body.endpoint);
        return { success: true };
    }

    @Get('preferences')
    @ApiOperation({ summary: 'Get notification preferences' })
    @ApiResponse({ status: 200, type: NotificationPreferencesResponseDto })
    async getPreferences(
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
    ): Promise<NotificationPreferencesResponseDto> {
        return this.notificationService.getPreferences(userLoginId);
    }

    @Patch('preferences')
    @ApiOperation({ summary: 'Update notification preferences' })
    @ApiResponse({ status: 200, type: NotificationPreferencesResponseDto })
    async updatePreferences(
        @Param('userLoginId', new ParseUUIDPipe()) userLoginId: string,
        @Body() body: UpdatePreferencesDto,
    ): Promise<NotificationPreferencesResponseDto> {
        return this.notificationService.updatePreferences(userLoginId, body);
    }
}

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(InternalServiceGuard)
export class NotificationPublicController {
    constructor(private readonly pushSender: PushSenderService) {}

    @Get('vapid-public-key')
    @ApiOperation({ summary: 'Get the VAPID public key for push subscription' })
    getVapidPublicKey(): { publicKey: string | null } {
        return { publicKey: this.pushSender.publicKey ?? null };
    }
}
