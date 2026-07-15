import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { LearningSettingsController } from './learning-settings.controller';
import { LearningSettingsService } from './learning-settings.service';

@Module({
    imports: [PrismaModule],
    controllers: [LearningSettingsController],
    providers: [LearningSettingsService],
    exports: [LearningSettingsService],
})
export class LearningSettingsModule {}
