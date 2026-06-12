import { AppModule } from '@/app.module';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

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
        .addTag('daily-habit', 'Daily practice goal and streak endpoints')
        .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);

    const configService = app.get(ConfigService);

    const corsEnabledOrigins = (
        configService.get<string>('corsEnabledOrigins') ?? ''
    ).split(',');

    app.enableCors({
        origin: corsEnabledOrigins,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    });

    const appPort = configService.get<number>('port');

    await app.listen(appPort as number);
    console.log(`Learning Service HTTP is running on port ${appPort}`);
    console.log(`CORS enabled origins: ${corsEnabledOrigins.join(', ')}`);
    console.log(
        `Swagger documentation available at http://localhost:${appPort}/api`,
    );
}

void bootstrap();
