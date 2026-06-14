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
