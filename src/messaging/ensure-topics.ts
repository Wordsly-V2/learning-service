import { Logger } from '@nestjs/common';
import { Kafka, type KafkaConfig } from 'kafkajs';

/**
 * Creates the topics this service consumes if they don't exist yet, and waits
 * for their leaders, before the consumer subscribes.
 *
 * Without it a fresh broker (or a new topic) crashed the consumer at boot with
 * UNKNOWN_TOPIC_OR_PARTITION: subscribing auto-created the topic, but its
 * leader wasn't elected by the time the consumer asked for it. Best effort: a
 * managed broker may forbid creating topics, which only earns a warning.
 */
export async function ensureTopics(params: {
    brokers: string[];
    ssl: KafkaConfig['ssl'];
    topics: string[];
    logger: Logger;
}): Promise<void> {
    const { brokers, ssl, topics, logger } = params;
    const admin = new Kafka({
        clientId: 'learning-service-admin',
        brokers,
        ssl,
        retry: { retries: 2 },
    }).admin();
    try {
        await admin.connect();
        // Only the missing ones: asking for an existing topic makes the broker
        // answer with an error, which kafkajs logs at error level.
        const existing = new Set(await admin.listTopics());
        const missing = topics.filter((topic) => !existing.has(topic));
        if (missing.length === 0) return;
        await admin.createTopics({
            topics: missing.map((topic) => ({ topic })),
            waitForLeaders: true,
        });
        logger.log(`Created Kafka topics: ${missing.join(', ')}`);
    } catch (error) {
        logger.warn(
            `Could not make sure Kafka topics exist (${topics.join(', ')}): ${String(error)}`,
        );
    } finally {
        await admin.disconnect().catch(() => undefined);
    }
}
