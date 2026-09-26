import { Controller, Logger } from '@nestjs/common';
import {
    Ctx,
    EventPattern,
    KafkaContext,
    Payload,
} from '@nestjs/microservices';
import { PATH_PROGRESS_TOPIC } from '@/messaging/constants';
import {
    commitCurrentMessage,
    consumeWithRetry,
} from '@/messaging/kafka-helpers';
import { parsePathProgressPayload } from './path-progress.logic';
import { PathProgressService } from './path-progress.service';

/** Wordsly Path totals from curriculum-service, turned into achievements. */
@Controller()
export class PathProgressConsumer {
    private readonly logger = new Logger(PathProgressConsumer.name);

    constructor(private readonly pathProgress: PathProgressService) {}

    @EventPattern(PATH_PROGRESS_TOPIC)
    async handlePathProgress(
        @Payload() payload: unknown,
        @Ctx() context: KafkaContext,
    ): Promise<void> {
        const event = parsePathProgressPayload(payload);
        if (!event) {
            this.logger.error(
                `Ignoring malformed ${PATH_PROGRESS_TOPIC} message: ` +
                    `${context.getMessage()?.value?.toString() ?? ''}`,
            );
            await commitCurrentMessage(context);
            return;
        }

        await consumeWithRetry({
            context,
            logger: this.logger,
            operation: `apply Path totals (${PATH_PROGRESS_TOPIC})`,
            handler: async () => {
                await this.pathProgress.apply(event);
            },
        });
    }
}
