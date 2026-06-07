export default () => ({
    port: parseInt(process.env.PORT ?? '3003', 10) ?? 3003,
    internalServiceToServiceToken:
        process.env.INTERNAL_SERVICE_TO_SERVICE_TOKEN,
    spacedRepetition: {
        /** 'fsrs' (default) or 'sm2' for A/B comparison */
        algorithm:
            process.env.SPACED_REPETITION_ALGORITHM === 'sm2' ? 'sm2' : 'fsrs',
    },
    database: {
        url: process.env.DATABASE_URL,
    },
    kafka: {
        brokers: process.env.KAFKA_BROKERS,
        ca: process.env.KAFKA_CA,
        cert: process.env.KAFKA_CERT,
        key: process.env.KAFKA_KEY,
    },
});
