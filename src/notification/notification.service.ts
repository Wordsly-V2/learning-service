import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { v7 as uuidv7 } from 'uuid';
import {
    NotificationPreferencesResponseDto,
    SubscribeDto,
    UpdatePreferencesDto,
} from './dto/notification.dto';

const DEFAULT_PREFERENCES = {
    streakReminderEnabled: false,
    reminderTime: '19:00',
    timezone: 'UTC',
};

@Injectable()
export class NotificationService {
    constructor(private readonly prisma: PrismaService) {}

    /** Upsert a subscription keyed by endpoint (re-subscribe moves ownership). */
    async subscribe(userLoginId: string, body: SubscribeDto): Promise<void> {
        await this.prisma.pushSubscription.upsert({
            where: { endpoint: body.endpoint },
            create: {
                id: uuidv7(),
                userLoginId,
                endpoint: body.endpoint,
                p256dh: body.keys.p256dh,
                auth: body.keys.auth,
                userAgent: body.userAgent,
            },
            update: {
                userLoginId,
                p256dh: body.keys.p256dh,
                auth: body.keys.auth,
                userAgent: body.userAgent,
            },
        });
    }

    async unsubscribe(userLoginId: string, endpoint: string): Promise<void> {
        await this.prisma.pushSubscription.deleteMany({
            where: { userLoginId, endpoint },
        });
    }

    async getPreferences(
        userLoginId: string,
    ): Promise<NotificationPreferencesResponseDto> {
        const [pref, subCount] = await Promise.all([
            this.prisma.notificationPreference.findUnique({
                where: { userLoginId },
            }),
            this.prisma.pushSubscription.count({ where: { userLoginId } }),
        ]);
        return {
            streakReminderEnabled:
                pref?.streakReminderEnabled ??
                DEFAULT_PREFERENCES.streakReminderEnabled,
            reminderTime:
                pref?.reminderTime ?? DEFAULT_PREFERENCES.reminderTime,
            timezone: pref?.timezone ?? DEFAULT_PREFERENCES.timezone,
            hasSubscription: subCount > 0,
        };
    }

    async updatePreferences(
        userLoginId: string,
        body: UpdatePreferencesDto,
    ): Promise<NotificationPreferencesResponseDto> {
        await this.prisma.notificationPreference.upsert({
            where: { userLoginId },
            create: { userLoginId, ...body },
            update: { ...body },
        });
        return this.getPreferences(userLoginId);
    }
}
