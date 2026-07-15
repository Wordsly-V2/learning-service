import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { UserLevelModule } from '@/user-level/user-level.module';
import { LearningSettingsModule } from '@/learning-settings/learning-settings.module';
import { WordProgressConsumer } from './word-progress.consumer';
import { WordProgressController } from './word-progress.controller';
import { WordProgressService } from './word-progress.service';

@Module({
    imports: [PrismaModule, UserLevelModule, LearningSettingsModule],
    controllers: [WordProgressController, WordProgressConsumer],
    providers: [WordProgressService],
    exports: [WordProgressService],
})
export class WordProgressModule {}
