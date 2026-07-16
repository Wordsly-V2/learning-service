import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { validateEnv } from './config/validate-env';
import { PrismaModule } from './prisma/prisma.module';
import { DailyHabitModule } from './daily-habit/daily-habit.module';
import { WordProgressModule } from './word-progress/word-progress.module';
import { LearningReportModule } from './learning-report/learning-report.module';
import { UserLevelModule } from './user-level/user-level.module';
import { LearningSettingsModule } from './learning-settings/learning-settings.module';
import { UserPreferencesModule } from './user-preferences/user-preferences.module';
import { AchievementModule } from './achievement/achievement.module';
import { NotificationModule } from './notification/notification.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            load: [configuration],
            validate: validateEnv,
        }),
        ScheduleModule.forRoot(),
        PrismaModule,
        WordProgressModule,
        DailyHabitModule,
        LearningReportModule,
        UserLevelModule,
        LearningSettingsModule,
        UserPreferencesModule,
        AchievementModule,
        NotificationModule,
    ],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule {}
