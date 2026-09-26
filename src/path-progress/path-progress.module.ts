import { Module } from '@nestjs/common';
import { AchievementModule } from '@/achievement/achievement.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { PathProgressConsumer } from './path-progress.consumer';
import { PathProgressService } from './path-progress.service';

@Module({
    imports: [PrismaModule, AchievementModule],
    controllers: [PathProgressConsumer],
    providers: [PathProgressService],
})
export class PathProgressModule {}
