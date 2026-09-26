import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { LearningReportController } from './learning-report.controller';
import { LearningReportService } from './learning-report.service';

@Module({
    imports: [PrismaModule],
    controllers: [LearningReportController],
    providers: [LearningReportService],
    // The admin area shows a learner's report exactly as they see it.
    exports: [LearningReportService],
})
export class LearningReportModule {}
