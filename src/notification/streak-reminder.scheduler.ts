import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@/prisma/prisma.service';
import { parseClientDate } from '@/daily-habit/daily-habit-date.util';
import {
    effectiveGoalStreak,
    isStreakAtRisk,
} from '@/daily-habit/daily-habit.logic';
import { PushSenderService } from './push-sender.service';
import { localDateInZone, reminderTimeWindow } from './streak-reminder.logic';

/**
 * Every 15 minutes: find users whose local reminder time has arrived, whose
 * streak is at risk, and who haven't been reminded today, then push a nudge.
 * A claim-first updateMany makes it safe across multiple instances.
 */
@Injectable()
export class StreakReminderScheduler {
    private readonly logger = new Logger(StreakReminderScheduler.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly pushSender: PushSenderService,
    ) {}

    @Cron('*/15 * * * *')
    async sendDueReminders(): Promise<void> {
        if (!this.pushSender.isEnabled) {
            return;
        }
        const now = new Date();

        // Candidate users: reminders enabled, an active streak, ≥1 subscription.
        const prefs = await this.prisma.notificationPreference.findMany({
            where: { streakReminderEnabled: true },
        });
        if (prefs.length === 0) {
            return;
        }

        for (const pref of prefs) {
            try {
                await this.processUser(pref, now);
            } catch (err) {
                this.logger.error(
                    `Reminder check failed for ${pref.userLoginId}: ${String(err)}`,
                );
            }
        }
    }

    private async processUser(
        pref: {
            userLoginId: string;
            timezone: string;
            reminderTime: string;
            lastReminderSentDate: Date | null;
        },
        now: Date,
    ): Promise<void> {
        const habit = await this.prisma.dailyHabit.findUnique({
            where: { userLoginId: pref.userLoginId },
        });
        if (!habit || habit.streak <= 0) {
            return;
        }

        const localDate = localDateInZone(now, pref.timezone);
        const lastSent = pref.lastReminderSentDate
            ? localDateInZone(pref.lastReminderSentDate, 'UTC')
            : null;

        const window = reminderTimeWindow({
            now,
            timezone: pref.timezone,
            reminderTime: pref.reminderTime,
            lastReminderSentDate: lastSent,
        });
        if (!window.timeWindowOpen) {
            return;
        }

        // Only nudge when the streak is genuinely at risk (practiced yesterday,
        // not yet today) using the user-local date.
        if (!isStreakAtRisk(habit.streak, habit.lastPracticeDate, localDate)) {
            return;
        }

        // Claim-first: mark sent before pushing so concurrent instances don't
        // double-send. A zero count means another instance already claimed it.
        const claim = await this.prisma.notificationPreference.updateMany({
            where: {
                userLoginId: pref.userLoginId,
                OR: [
                    { lastReminderSentDate: null },
                    {
                        lastReminderSentDate: {
                            not: parseClientDate(localDate),
                        },
                    },
                ],
            },
            data: { lastReminderSentDate: parseClientDate(localDate) },
        });
        if (claim.count === 0) {
            return;
        }

        const displayStreak = effectiveGoalStreak(
            habit.streak,
            habit.lastPracticeDate,
            localDate,
        );
        const streak = displayStreak > 0 ? displayStreak : habit.streak;
        await this.pushSender.sendToUser(pref.userLoginId, {
            title: `Your ${streak}-day streak is at risk 🔥`,
            body: 'A few minutes of practice keeps it alive. Jump back in!',
            url: '/learn?src=push',
        });
    }
}
