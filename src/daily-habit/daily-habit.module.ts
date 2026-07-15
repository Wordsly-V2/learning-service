import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { UserLevelModule } from '@/user-level/user-level.module';
import { AchievementModule } from '@/achievement/achievement.module';
import { DailyHabitController } from './daily-habit.controller';
import { DailyHabitService } from './daily-habit.service';

@Module({
    imports: [PrismaModule, UserLevelModule, AchievementModule],
    controllers: [DailyHabitController],
    providers: [DailyHabitService],
    exports: [DailyHabitService],
})
export class DailyHabitModule {}
