export default () => ({
    port: parseInt(process.env.PORT ?? '3003', 10) ?? 3003,
    corsEnabledOrigins: process.env.CORS_ENABLED_ORIGINS,
    internalServiceToServiceToken:
        process.env.INTERNAL_SERVICE_TO_SERVICE_TOKEN,
    // Identity verification. `issuer` is the PUBLIC address tokens claim (the
    // gateway), while `jwksUri` is the INTERNAL address this service fetches
    // keys from -- they are deliberately different, see auth/jwt/jwks.provider.ts.
    // Peer service that owns word scopes (which words are in a course/lesson).
    vocabularyService: {
        host: process.env.VOCABULARY_SERVICE_HOST,
        timeout: parseInt(
            process.env.VOCABULARY_SERVICE_HTTP_TIMEOUT ?? '15000',
            10,
        ),
    },
    auth: {
        jwksUri: process.env.AUTH_JWKS_URI,
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE ?? 'wordsly-api',
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
    // Web Push (VAPID). All optional: when unset, push is disabled and the
    // sender/scheduler no-op (mirrors the Kafka-optional pattern).
    webPush: {
        vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
        vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
        vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:admin@wordsly.app',
    },
});
