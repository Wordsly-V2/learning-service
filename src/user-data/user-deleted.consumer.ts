import { USER_DELETED_TOPIC } from '@/messaging/constants';
import {
    commitCurrentMessage,
    consumeWithRetry,
} from '@/messaging/kafka-helpers';
import { Controller, Logger } from '@nestjs/common';
import {
    Ctx,
    EventPattern,
    KafkaContext,
    Payload,
} from '@nestjs/microservices';
import { UserDataService } from './user-data.service';
import { parseUserDeletedPayload } from './user-deleted.payload';

/**
 * An admin deleted an account in auth-service: drop everything held here for
 * it. Delivery is at least once (auth's outbox can re-send after a crash), so
 * the purge is idempotent and a redelivery just commits.
 */
@Controller()
export class UserDeletedConsumer {
    private readonly logger = new Logger(UserDeletedConsumer.name);

    constructor(private readonly userData: UserDataService) {}

    @EventPattern(USER_DELETED_TOPIC)
    async handleUserDeleted(
        @Payload() payload: unknown,
        @Ctx() context: KafkaContext,
    ): Promise<void> {
        const userLoginId = parseUserDeletedPayload(payload);
        if (!userLoginId) {
            this.logger.error(
                `Ignoring malformed ${USER_DELETED_TOPIC} message: ` +
                    `${context.getMessage()?.value?.toString() ?? ''}`,
            );
            await commitCurrentMessage(context);
            return;
        }

        await consumeWithRetry({
            context,
            logger: this.logger,
            operation: `purge deleted user ${userLoginId} (${USER_DELETED_TOPIC})`,
            handler: async () => {
                await this.userData.purgeUser(userLoginId);
            },
        });
    }
}
