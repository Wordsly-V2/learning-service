import { AppModule } from '@/app.module';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Transport } from '@nestjs/microservices';
import { buildCorsOptions, parseCorsOrigins } from '@/config/cors';
import { runWithCaller } from '@/http-clients/caller-context';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

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

    const configService = app.get(ConfigService);
    const corsEnabledOrigins = configService.get<string>('corsEnabledOrigins');

    const corsOptions = buildCorsOptions(corsEnabledOrigins);
    if (corsOptions) {
        app.enableCors(corsOptions);
    }

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
    console.log(`Learning Service HTTP is running on port ${appPort}`);
    console.log(
        `CORS enabled origins: ${parseCorsOrigins(corsEnabledOrigins).join(', ') || 'none'}`,
    );
    console.log(
        `Swagger documentation available at http://localhost:${appPort}/api`,
    );
}

void bootstrap();
