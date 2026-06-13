import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

export function parseCorsOrigins(raw: string | undefined): string[] {
    return (raw ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}

export function buildCorsOptions(
    corsEnabledOrigins: string | undefined,
): CorsOptions | undefined {
    const allowedOrigins = parseCorsOrigins(corsEnabledOrigins);

    if (allowedOrigins.length === 0) {
        return undefined;
    }

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
