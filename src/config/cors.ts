import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

export function parseCorsOrigins(raw: string | undefined): string[] {
    return (raw ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}

/**
 * Always returns options — never undefined.
 *
 * It used to return undefined for an empty origin list, and the caller then
 * skipped enableCors altogether, so a blank CORS_ENABLED_ORIGINS silently
 * disabled CORS rather than locking it down. The variable is now required at
 * boot, and an empty list here means "allow nothing cross-origin", which is the
 * safe reading.
 */
export function buildCorsOptions(
    corsEnabledOrigins: string | undefined,
): CorsOptions {
    const allowedOrigins = parseCorsOrigins(corsEnabledOrigins);

    return {
        origin: (origin, callback) => {
            if (!origin) {
                callback(null, true);
                return;
            }

            if (allowedOrigins.includes(origin)) {
                callback(null, origin);
                return;
            }

            callback(new Error('Not allowed by CORS'));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    };
}
