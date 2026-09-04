import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/jwt/auth.module';
import { AccessGuard } from './auth/jwt/access.guard';
import { UserScopeGuard } from './auth/jwt/user-scope.guard';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { validateEnv } from './config/validate-env';
import { HttpClientsModule } from './http-clients/http-clients.module';
import { PrismaModule } from './prisma/prisma.module';
import { DailyHabitModule } from './daily-habit/daily-habit.module';
import { WordProgressModule } from './word-progress/word-progress.module';
import { LearningReportModule } from './learning-report/learning-report.module';
import { UserLevelModule } from './user-level/user-level.module';
import { LearningSettingsModule } from './learning-settings/learning-settings.module';
import { UserPreferencesModule } from './user-preferences/user-preferences.module';
import { AchievementModule } from './achievement/achievement.module';
import { NotificationModule } from './notification/notification.module';
import { SyncModule } from './sync/sync.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            load: [configuration],
            validate: validateEnv,
        }),
        AuthModule,
        HttpClientsModule,
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
        SyncModule,
    ],
    controllers: [AppController],
    providers: [
        AppService,
        // Registering globally makes the service deny-by-default, so a
        // controller that forgets a decorator fails closed rather than being
        // reachable by anyone who can route to it. AccessGuard establishes who
        // the caller is; UserScopeGuard makes sure the request did not try to
        // name someone else.
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_GUARD, useClass: UserScopeGuard },
    ],
})
export class AppModule {}
