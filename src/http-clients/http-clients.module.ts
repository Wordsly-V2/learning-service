import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';

export const VOCABULARY_SERVICE_HTTP = 'VOCABULARY_SERVICE_HTTP';

/**
 * Peer-service HTTP client.
 *
 * Word *scopes* (which words are in a course or lesson) are owned by
 * vocabulary-service, while progress over those words is owned here. Resolving a
 * scope used to happen in the gateway, which called both services and stitched
 * the results together; with the gateway reduced to a proxy, the service that
 * owns the response makes the call instead.
 *
 * Authenticated with the shared internal token, never with the end user's
 * bearer token: this is a call between peers inside the mesh.
 */
@Global()
@Module({
    providers: [
        {
            provide: VOCABULARY_SERVICE_HTTP,
            inject: [ConfigService],
            useFactory: (configService: ConfigService) =>
                axios.create({
                    baseURL: configService.get<string>(
                        'vocabularyService.host',
                    ),
                    timeout:
                        configService.get<number>(
                            'vocabularyService.timeout',
                        ) ?? 15_000,
                    headers: {
                        'x-service-token': configService.get<string>(
                            'internalServiceToServiceToken',
                        ),
                    },
                    // Practice sessions resolve scopes on every start, so the
                    // connection is worth keeping alive.
                    httpAgent: new HttpAgent({
                        keepAlive: true,
                        maxSockets: 100,
                    }),
                    httpsAgent: new HttpsAgent({
                        keepAlive: true,
                        maxSockets: 100,
                    }),
                }),
        },
    ],
    exports: [VOCABULARY_SERVICE_HTTP],
})
export class HttpClientsModule {}
