import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
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
export class NotificationController {
    constructor(
        private readonly notificationService: NotificationService,
        private readonly pushSender: PushSenderService,
    ) {}

    // Lives on the user-scoped path rather than a bare `/notifications/...`
    // one: the gateway only routes `/users/*/notifications**` here, and the
    // key is only ever fetched by a signed-in client about to subscribe.
    @Get('vapid-public-key')
    @ApiOperation({ summary: 'Get the VAPID public key for push subscription' })
    getVapidPublicKey(): { publicKey: string | null } {
        return { publicKey: this.pushSender.publicKey ?? null };
    }

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
