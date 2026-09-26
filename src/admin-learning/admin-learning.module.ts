import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { LearningReportModule } from '@/learning-report/learning-report.module';
import { AdminLearningController } from './admin-learning.controller';
import { AdminLearningService } from './admin-learning.service';

@Module({
    imports: [PrismaModule, LearningReportModule],
    controllers: [AdminLearningController],
    providers: [AdminLearningService],
})
export class AdminLearningModule {}
