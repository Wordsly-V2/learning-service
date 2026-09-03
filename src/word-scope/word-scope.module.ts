import { Module } from '@nestjs/common';
import { WordScopeService } from './word-scope.service';

@Module({
    providers: [WordScopeService],
    exports: [WordScopeService],
})
export class WordScopeModule {}
