import { AppModule } from '@/app.module';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Transport } from '@nestjs/microservices';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
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
        .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);

    const configService = app.get(ConfigService);
    const appPort = configService.get<number>('port');

    const brokers = configService.get<string>('kafka.brokers') ?? '';
    const ca = configService.get<string>('kafka.ca') ?? '';
    const cert = configService.get<string>('kafka.cert') ?? '';
    const key = configService.get<string>('kafka.key') ?? '';

    app.connectMicroservice({
        transport: Transport.KAFKA,
        options: {
            clientId: 'learning-service-client',
            client: {
                brokers: brokers.split(',').filter(Boolean),
                ssl: {
                    rejectUnauthorized: true,
                    ca,
                    cert,
                    key,
                },
            },
            consumer: {
                groupId: 'learning-service-consumer',
            },
            run: {
                autoCommit: false,
            },
        },
    });

    await app.startAllMicroservices();
    await app.listen(appPort as number);
    console.log(`Learning Service HTTP is running on port ${appPort}`);
    console.log(
        `Swagger documentation available at http://localhost:${appPort}/api`,
    );
}

void bootstrap();
