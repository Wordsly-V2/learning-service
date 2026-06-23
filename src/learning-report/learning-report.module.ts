import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { LearningReportController } from './learning-report.controller';
import { LearningReportService } from './learning-report.service';

@Module({
  imports: [PrismaModule],
  controllers: [LearningReportController],
  providers: [LearningReportService],
})
export class LearningReportModule {}
