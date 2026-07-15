import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import * as webPush from 'web-push';

export interface PushPayload {
    title: string;
    body: string;
    url?: string;
}

/**
 * Wraps web-push. No-ops (with a warning) when VAPID keys are unset so the
 * service runs without push configured, mirroring the Kafka-optional pattern.
 * Stale subscriptions (404/410) are pruned on send.
 */
@Injectable()
export class PushSenderService {
    private readonly logger = new Logger(PushSenderService.name);
    private readonly enabled: boolean;

    constructor(
        private readonly config: ConfigService,
        private readonly prisma: PrismaService,
    ) {
        const publicKey = this.config.get<string>('webPush.vapidPublicKey');
        const privateKey = this.config.get<string>('webPush.vapidPrivateKey');
        const subject =
            this.config.get<string>('webPush.vapidSubject') ??
            'mailto:admin@wordsly.app';
        this.enabled = Boolean(publicKey && privateKey);
        if (this.enabled) {
            webPush.setVapidDetails(subject, publicKey!, privateKey!);
        } else {
            this.logger.warn(
                'VAPID keys not configured — web push is disabled.',
            );
        }
    }

    get isEnabled(): boolean {
        return this.enabled;
    }

    get publicKey(): string | undefined {
        return this.config.get<string>('webPush.vapidPublicKey');
    }

    /** Send a payload to all of a user's subscriptions, pruning dead ones. */
    async sendToUser(userLoginId: string, payload: PushPayload): Promise<void> {
        if (!this.enabled) {
            return;
        }
        const subscriptions = await this.prisma.pushSubscription.findMany({
            where: { userLoginId },
        });
        const json = JSON.stringify(payload);
        await Promise.all(
            subscriptions.map(async (sub) => {
                try {
                    await webPush.sendNotification(
                        {
                            endpoint: sub.endpoint,
                            keys: { p256dh: sub.p256dh, auth: sub.auth },
                        },
                        json,
                    );
                } catch (err) {
                    const statusCode = (err as { statusCode?: number })
                        .statusCode;
                    if (statusCode === 404 || statusCode === 410) {
                        await this.prisma.pushSubscription
                            .delete({ where: { endpoint: sub.endpoint } })
                            .catch(() => undefined);
                    } else {
                        this.logger.error(
                            `Push send failed for ${userLoginId}: ${String(err)}`,
                        );
                    }
                }
            }),
        );
    }
}
