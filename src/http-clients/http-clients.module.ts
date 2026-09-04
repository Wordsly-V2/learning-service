import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import {
    getCallerAuthorization,
    MissingCallerCredentialError,
} from '@/http-clients/caller-context';

export const VOCABULARY_SERVICE_HTTP = 'VOCABULARY_SERVICE_HTTP';

/**
 * Peer-service HTTP client.
 *
 * Authenticated with the **caller's own access token**, forwarded per request.
 * It used to carry a shared internal token set once at boot, which every
 * service's guards accepted as proof of being a peer and which therefore
 * skipped the per-user checks entirely — one leaked value could act as any
 * learner on any route. Forwarding the caller's token instead means
 * vocabulary-service verifies it and applies exactly the checks it would for a
 * browser, so this service can never reach further than the user it is serving.
 *
 * The credential comes from an AsyncLocalStorage store rather than being passed
 * down through every call, so a peer call outside a request fails loudly
 * instead of silently borrowing something stronger.
 */
@Global()
@Module({
    providers: [
        {
            provide: VOCABULARY_SERVICE_HTTP,
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
                const instance = axios.create({
                    baseURL: configService.get<string>(
                        'vocabularyService.host',
                    ),
                    timeout:
                        configService.get<number>(
                            'vocabularyService.timeout',
                        ) ?? 15_000,
                    httpAgent: new HttpAgent({
                        keepAlive: true,
                        maxSockets: 100,
                    }),
                    httpsAgent: new HttpsAgent({
                        keepAlive: true,
                        maxSockets: 100,
                    }),
                });

                instance.interceptors.request.use((config) => {
                    const authorization = getCallerAuthorization();
                    if (!authorization) {
                        throw new MissingCallerCredentialError();
                    }
                    config.headers.set('Authorization', authorization);
                    return config;
                });

                return instance;
            },
        },
    ],
    exports: [VOCABULARY_SERVICE_HTTP],
})
export class HttpClientsModule {}
