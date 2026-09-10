import { WORDS_DELETED_TOPIC } from '@/messaging/constants';
import { consumeWithRetry } from '@/messaging/kafka-helpers';
import { Controller, Logger } from '@nestjs/common';
import {
    Ctx,
    EventPattern,
    KafkaContext,
    Payload,
} from '@nestjs/microservices';
import { WordProgressService } from './word-progress.service';

/** Payload for vocabulary_word-deleted Kafka message (one per word). */
export interface WordDeletedPayload {
    wordIds: string[];
}

/**
 * Handles Kafka events for word progress: removes all progress rows for a deleted word.
 */
@Controller()
export class WordProgressConsumer {
    private readonly logger = new Logger(WordProgressConsumer.name);

    constructor(private readonly wordProgressService: WordProgressService) {}

    @EventPattern(WORDS_DELETED_TOPIC)
    async handleWordDeleted(
        @Payload() payload: WordDeletedPayload,
        @Ctx() context: KafkaContext,
    ): Promise<void> {
        // No onDeadLetter: this service has no Kafka producer, and adding one
        // purely to re-publish a message it could not read is not worth a new
        // broker connection to maintain. The payload is logged at error level,
        // which is enough to replay it by hand — and committing means one bad
        // message no longer stops every later word deletion from being applied.
        await consumeWithRetry({
            context,
            logger: this.logger,
            operation: `delete word progress (${WORDS_DELETED_TOPIC})`,
            handler: () =>
                this.wordProgressService.deleteProgressForWords(
                    payload.wordIds,
                ),
        });
    }
}
