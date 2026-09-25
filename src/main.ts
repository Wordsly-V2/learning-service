import { AppModule } from '@/app.module';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Transport } from '@nestjs/microservices';
import { buildCorsOptions, parseCorsOrigins } from '@/config/cors';
import { runWithCaller } from '@/http-clients/caller-context';
import helmet from 'helmet';
import { requestIdMiddleware } from '@/common/request-id.middleware';
import { RequestContextLogger } from '@/common/request-context-logger';
import { CONSUMED_TOPICS } from '@/messaging/constants';
import { ensureTopics } from '@/messaging/ensure-topics';

const bootLogger = new Logger('Bootstrap');

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    app.useLogger(app.get(RequestContextLogger));

    // First, so every later middleware, guard and handler runs inside
    // the store and logs the same id the caller was given back.
    app.use(requestIdMiddleware);

    // Put the caller's credential in scope for the whole request, before
    // anything else runs. The vocabulary client reads it from here rather than
    // holding a credential of its own, so a peer call can never reach further
    // than the user whose request prompted it. Registered first so guards and
    // handlers alike are inside the store; Kafka handlers are not, which is
    // exactly why a peer call from a consumer throws.
    app.use(
        (
            req: { headers: Record<string, unknown> },
            _res: unknown,
            next: () => void,
        ) =>
            runWithCaller(
                req.headers.authorization as string | undefined,
                next,
            ),
    );

    // Baseline security headers. CSP is off because this service serves the
    // Swagger UI at /api, whose inline bootstrap script the default policy
    // blocks — leaving the docs page blank. Every response here is JSON or that
    // docs page, so there is no HTML injection surface for CSP to protect.
    app.use(helmet({ contentSecurityPolicy: false }));

    const configService = app.get(ConfigService);
    const corsEnabledOrigins = configService.get<string>('corsEnabledOrigins');

    app.enableCors(buildCorsOptions(corsEnabledOrigins));

    app.useGlobalPipes(
        new ValidationPipe({
            transform: true,
            whitelist: true,
            transformOptions: {
                enableImplicitConversion: true,
            },
        }),
    );

    const config = new DocumentBuilder()
        .setTitle('Learning Service API')
        .setDescription('API documentation for the Learning Service')
        .setVersion('1.0')
        .addTag('health', 'Health check endpoints')
        .addTag(
            'word-progress',
            'Word progress and spaced repetition endpoints',
        )
        .addTag('daily-habit', 'Daily practice goal and streak endpoints')
        .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);

    const appPort = configService.get<number>('port');

    const brokers = configService.get<string>('kafka.brokers') ?? '';
    const ca = configService.get<string>('kafka.ca') ?? '';
    const cert = configService.get<string>('kafka.cert') ?? '';
    const key = configService.get<string>('kafka.key') ?? '';
    const brokerList = brokers.split(',').filter(Boolean);

    // TLS only when there is material to do it with. A managed broker supplies
    // CA/cert/key and is verified exactly as before; a plaintext broker (the one
    // in docker-compose, for local dev) supplies none, and asking for TLS anyway
    // just failed the handshake and took the whole process down with an
    // unhandled rejection.
    const kafkaSsl =
        ca || cert || key ? { rejectUnauthorized: true, ca, cert, key } : false;

    if (brokerList.length > 0) {
        await ensureTopics({
            brokers: brokerList,
            ssl: kafkaSsl,
            topics: CONSUMED_TOPICS,
            logger: bootLogger,
        });
        app.connectMicroservice({
            transport: Transport.KAFKA,
            options: {
                clientId: 'learning-service-client',
                client: {
                    brokers: brokerList,
                    ssl: kafkaSsl,
                },
                consumer: {
                    groupId: 'learning-service-consumer',
                },
                run: {
                    autoCommit: false,
                },
            },
        });
    }

    await app.startAllMicroservices();
    await app.listen(appPort as number);
    bootLogger.log(`Learning Service HTTP is running on port ${appPort}`);
    bootLogger.log(
        `CORS enabled origins: ${parseCorsOrigins(corsEnabledOrigins).join(', ') || 'none'}`,
    );
    bootLogger.log(
        `Swagger documentation available at http://localhost:${appPort}/api`,
    );
}

void bootstrap();
