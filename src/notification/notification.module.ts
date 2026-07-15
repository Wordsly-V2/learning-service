import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import {
    NotificationController,
    NotificationPublicController,
} from './notification.controller';
import { NotificationService } from './notification.service';
import { PushSenderService } from './push-sender.service';
import { StreakReminderScheduler } from './streak-reminder.scheduler';

@Module({
    imports: [PrismaModule],
    controllers: [NotificationController, NotificationPublicController],
    providers: [
        NotificationService,
        PushSenderService,
        StreakReminderScheduler,
    ],
    exports: [NotificationService, PushSenderService],
})
export class NotificationModule {}
