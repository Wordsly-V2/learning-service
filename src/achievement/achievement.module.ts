import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { UserLevelModule } from '@/user-level/user-level.module';
import { AchievementService } from './achievement.service';

@Module({
    imports: [PrismaModule, UserLevelModule],
    providers: [AchievementService],
    exports: [AchievementService],
})
export class AchievementModule {}
