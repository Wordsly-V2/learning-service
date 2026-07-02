import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { UserLevelModule } from '@/user-level/user-level.module';
import { DailyHabitController } from './daily-habit.controller';
import { DailyHabitService } from './daily-habit.service';

@Module({
    imports: [PrismaModule, UserLevelModule],
    controllers: [DailyHabitController],
    providers: [DailyHabitService],
    exports: [DailyHabitService],
})
export class DailyHabitModule {}
