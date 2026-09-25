import {
    PATH_ITEMS_RETIRED_TOPIC,
    WORDS_DELETED_TOPIC,
} from '@/messaging/constants';
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
import { isUUID } from 'class-validator';
import { WordProgressService } from './word-progress.service';
import { SavedWordService } from '@/saved-word/saved-word.service';

/** Payload for a words_deleted Kafka message (one message per deleted batch). */
export interface WordDeletedPayload {
    wordIds: string[];
}

/**
 * Returns the payload's word ids, or null when the message is not a usable
 * `{ wordIds: uuid[] }`. This has to be strict: the ids go straight into a
 * cross-user `deleteMany`, and Prisma reads `{ in: undefined }` as "no filter",
 * so a missing field would delete every row in the table.
 */
export function parseWordDeletedPayload(payload: unknown): string[] | null {
    return parseUuidList(payload, 'wordIds');
}

/** `{ itemIds: uuid[] }` from curriculum-service, held to the same standard. */
export function parsePathItemsRetiredPayload(
    payload: unknown,
): string[] | null {
    return parseUuidList(payload, 'itemIds');
}

function parseUuidList(payload: unknown, key: string): string[] | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const ids = (payload as Record<string, unknown>)[key];
    if (!Array.isArray(ids) || ids.length === 0) return null;
    if (!ids.every((id) => typeof id === 'string' && isUUID(id))) {
        return null;
    }
    return ids as string[];
}

/**
 * Handles Kafka events for word progress: removes everything this service holds
 * for a deleted word — the schedule AND any learner's manual "difficult word"
 * flag, which would otherwise be left pointing at vocabulary that is gone.
 */
@Controller()
export class WordProgressConsumer {
    private readonly logger = new Logger(WordProgressConsumer.name);

    constructor(
        private readonly wordProgressService: WordProgressService,
        private readonly savedWordService: SavedWordService,
    ) {}

    @EventPattern(WORDS_DELETED_TOPIC)
    async handleWordDeleted(
        @Payload() payload: unknown,
        @Ctx() context: KafkaContext,
    ): Promise<void> {
        const wordIds = parseWordDeletedPayload(payload);
        if (!wordIds) {
            // Retrying cannot fix a malformed message, so skip straight to the
            // same log-and-commit that consumeWithRetry does when it gives up.
            this.logger.error(
                `Ignoring malformed ${WORDS_DELETED_TOPIC} message: ` +
                    `${context.getMessage()?.value?.toString() ?? ''}`,
            );
            await commitCurrentMessage(context);
            return;
        }

        // No onDeadLetter: this service has no Kafka producer, and adding one
        // purely to re-publish a message it could not read is not worth a new
        // broker connection to maintain. The payload is logged at error level,
        // which is enough to replay it by hand — and committing means one bad
        // message no longer stops every later word deletion from being applied.
        await consumeWithRetry({
            context,
            logger: this.logger,
            operation: `delete word progress (${WORDS_DELETED_TOPIC})`,
            handler: async () => {
                await this.wordProgressService.deleteProgressForWords(wordIds);
                await this.savedWordService.deleteForWords(wordIds);
            },
        });
    }

    /**
     * A Wordsly Path release dropped these items (archived): their review
     * cards go. Only Path progress is touched (`source = PATH`).
     */
    @EventPattern(PATH_ITEMS_RETIRED_TOPIC)
    async handlePathItemsRetired(
        @Payload() payload: unknown,
        @Ctx() context: KafkaContext,
    ): Promise<void> {
        const itemIds = parsePathItemsRetiredPayload(payload);
        if (!itemIds) {
            this.logger.error(
                `Ignoring malformed ${PATH_ITEMS_RETIRED_TOPIC} message: ` +
                    `${context.getMessage()?.value?.toString() ?? ''}`,
            );
            await commitCurrentMessage(context);
            return;
        }

        await consumeWithRetry({
            context,
            logger: this.logger,
            operation: `delete retired Path progress (${PATH_ITEMS_RETIRED_TOPIC})`,
            handler: () =>
                this.wordProgressService.deletePathProgressForItems(itemIds),
        });
    }
}
