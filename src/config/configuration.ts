export default () => ({
    port: parseInt(process.env.PORT ?? '3003', 10) ?? 3003,
    corsEnabledOrigins: process.env.CORS_ENABLED_ORIGINS,
    internalServiceToServiceToken:
        process.env.INTERNAL_SERVICE_TO_SERVICE_TOKEN,
    database: {
        url: process.env.DATABASE_URL,
    },
});
