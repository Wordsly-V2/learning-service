/**
 * Fail-fast validation of required environment variables at boot.
 * Wired into ConfigModule.forRoot({ validate }). Throwing here aborts startup
 * instead of letting the service run with missing/insecure defaults.
 */
const REQUIRED_ENV_VARS = [
    // Required, not optional: an empty value used to make buildCorsOptions
    // return undefined and the caller skip enableCors entirely, silently
    // disabling CORS instead of locking it down.
    'CORS_ENABLED_ORIGINS',
    'AUTH_JWKS_URI',
    'JWT_ISSUER',
    'VOCABULARY_SERVICE_HOST',
    'CURRICULUM_SERVICE_HOST',
    'DATABASE_URL',
] as const;

export function validateEnv(
    config: Record<string, unknown>,
): Record<string, unknown> {
    const missing = REQUIRED_ENV_VARS.filter(
        (key) => !config[key] || String(config[key]).trim() === '',
    );

    if (missing.length > 0) {
        throw new Error(
            `Missing required environment variables: ${missing.join(', ')}`,
        );
    }

    return config;
}
