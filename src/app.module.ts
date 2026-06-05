import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { DailyHabitModule } from './daily-habit/daily-habit.module';
import { WordProgressModule } from './word-progress/word-progress.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    PrismaModule,
    WordProgressModule,
    DailyHabitModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
