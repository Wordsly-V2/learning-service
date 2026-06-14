import { WORDS_DELETED_TOPIC } from '@/messaging/constants';
import { commitCurrentMessage } from '@/messaging/kafka-helpers';
import { Controller } from '@nestjs/common';
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
    constructor(private readonly wordProgressService: WordProgressService) {}

    @EventPattern(WORDS_DELETED_TOPIC)
    async handleWordDeleted(
        @Payload() payload: WordDeletedPayload,
        @Ctx() context: KafkaContext,
    ): Promise<void> {
        await this.wordProgressService.deleteProgressForWords(payload.wordIds);
        await commitCurrentMessage(context);
    }
}
