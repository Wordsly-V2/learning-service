import { AxiosHeaders } from 'axios';
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { ConfigService } from '@nestjs/config';
import {
    HttpClientsModule,
    VOCABULARY_SERVICE_HTTP,
} from '@/http-clients/http-clients.module';
import {
    MissingCallerCredentialError,
    runWithCaller,
} from '@/http-clients/caller-context';

/**
 * The peer client used to carry a shared internal token, set once at boot, that
 * every service accepted as proof of being a peer — which skipped the per-user
 * checks entirely. It now forwards the caller's own token, per request, and has
 * nothing to fall back on.
 */
describe('vocabulary service HTTP client', () => {
    const config = {
        get: (key: string) =>
            key === 'vocabularyService.host'
                ? 'http://vocabulary-service:3002'
                : 15_000,
    } as unknown as ConfigService;

    const build = (): AxiosInstance => {
        const providers = Reflect.getMetadata(
            'providers',
            HttpClientsModule,
        ) as {
            provide: string;
            useFactory: (c: ConfigService) => AxiosInstance;
        }[];

        const provider = providers.find(
            (p) => p.provide === VOCABULARY_SERVICE_HTTP,
        );
        if (!provider) throw new Error('client provider not registered');
        return provider.useFactory(config);
    };

    /** Run the request interceptor the way axios would, on an empty config. */
    const attachHeaders = (instance: AxiosInstance) => {
        const [interceptor] = (
            instance.interceptors.request as unknown as {
                handlers: {
                    fulfilled: (
                        c: InternalAxiosRequestConfig,
                    ) => InternalAxiosRequestConfig;
                }[];
            }
        ).handlers;

        return interceptor.fulfilled({
            headers: new AxiosHeaders(),
        } as InternalAxiosRequestConfig);
    };

    it('sends no shared credential of its own', () => {
        expect(JSON.stringify(build().defaults.headers)).not.toContain(
            'x-service-token',
        );
    });

    it("forwards the caller's own token", () => {
        const config = runWithCaller('Bearer caller-token', () =>
            attachHeaders(build()),
        );
        expect(config.headers.get('Authorization')).toBe('Bearer caller-token');
    });

    it('refuses to call a peer with no caller in scope', () => {
        // A cron job or Kafka consumer has no credential to forward, and must
        // do its work against this service's own database instead of reaching
        // for one that can act for anyone.
        expect(() => attachHeaders(build())).toThrow(
            MissingCallerCredentialError,
        );
    });
});
