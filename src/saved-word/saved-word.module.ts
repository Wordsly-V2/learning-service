import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { WordScopeModule } from '@/word-scope/word-scope.module';
import { SavedWordController } from './saved-word.controller';
import { SavedWordService } from './saved-word.service';

@Module({
    imports: [PrismaModule, WordScopeModule],
    controllers: [SavedWordController],
    providers: [SavedWordService],
    exports: [SavedWordService],
})
export class SavedWordModule {}
