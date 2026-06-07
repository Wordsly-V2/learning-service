import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { WordProgressController } from './word-progress.controller';
import { WordProgressService } from './word-progress.service';

@Module({
  imports: [PrismaModule],
  controllers: [WordProgressController],
  providers: [WordProgressService],
  exports: [WordProgressService],
})
export class WordProgressModule {}
