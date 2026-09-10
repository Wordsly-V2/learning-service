import { Logger } from '@nestjs/common';
import { KafkaContext } from '@nestjs/microservices';

/**
 * Commits the current message's offset so Kafka does not redeliver it.
 * Use only when autoCommit is disabled (run.autoCommit: false).
 * Call after successful processing so restarts redeliver if the app died before this.
 */
export async function commitCurrentMessage(
    context: KafkaContext,
): Promise<void> {
    const message = context.getMessage();
    const consumer = context.getConsumer?.();
    if (!consumer || message?.offset === undefined) return;

    const topic = context.getTopic?.();
    const partition = context.getPartition?.();
    if (topic === undefined || partition === undefined) return;

    await consumer.commitOffsets([
        {
            topic,
            partition,
            offset: (Number(message.offset) + 1).toString(),
        },
    ]);
}

/** Suffix for the dead-letter topic paired with a given topic. */
export function deadLetterTopic(topic: string): string {
    return `${topic}.dlq`;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_RETRY_MS = 500;

/**
 * Run a consumer handler so that a bad message cannot wedge the partition.
 *
 * Consumers here run with `autoCommit: false` and committed only on success, so
 * a handler that threw left the offset uncommitted and Kafka redelivered the
 * same message forever — the partition stopped dead and every later message,
 * valid or not, was never processed. One malformed payload halted the topic.
 *
 * So: retry a bounded number of times for the transient case (a database blip),
 * then give up on the message, hand it to `onDeadLetter` if a sink was provided,
 * and commit regardless. Committing a message we could not process is a
 * deliberate trade — the alternative is losing every subsequent message too.
 *
 * The failure is logged at error level with the payload, so a message that
 * reaches this point is recoverable by hand even where no sink exists.
 */
export async function consumeWithRetry(params: {
    context: KafkaContext;
    logger: Logger;
    /** Describes the work, for logs. */
    operation: string;
    handler: () => Promise<void>;
    maxAttempts?: number;
    /** Publishes the failed message somewhere durable, where one is available. */
    onDeadLetter?: (payload: {
        topic: string;
        value: string;
        error: string;
    }) => Promise<void>;
}): Promise<void> {
    const { context, logger, operation, handler, onDeadLetter } = params;
    const maxAttempts = params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await handler();
            await commitCurrentMessage(context);
            return;
        } catch (error) {
            lastError = error;
            logger.warn(
                `${operation} failed (attempt ${attempt}/${maxAttempts}): ${String(error)}`,
            );

            if (attempt < maxAttempts) {
                await new Promise((resolve) =>
                    setTimeout(resolve, BASE_RETRY_MS * 2 ** (attempt - 1)),
                );
            }
        }
    }

    const topic = context.getTopic?.() ?? 'unknown';
    const value = context.getMessage()?.value?.toString() ?? '';

    logger.error(
        `${operation} gave up after ${maxAttempts} attempts; ` +
            `dead-lettering and committing to unblock the partition. ` +
            `topic=${topic} payload=${value} error=${String(lastError)}`,
    );

    if (onDeadLetter) {
        try {
            await onDeadLetter({
                topic: deadLetterTopic(topic),
                value,
                error: String(lastError),
            });
        } catch (error) {
            // A dead-letter sink that is itself down must not re-wedge the
            // partition; the payload is already in the log above.
            logger.error(`Dead-letter publish failed: ${String(error)}`);
        }
    }

    await commitCurrentMessage(context);
}
