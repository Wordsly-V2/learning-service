import { Module } from '@nestjs/common';
import { CurriculumScopeService } from './curriculum-scope.service';
import { ItemScopeService } from './item-scope.service';
import { WordScopeService } from './word-scope.service';

@Module({
    providers: [WordScopeService, CurriculumScopeService, ItemScopeService],
    exports: [WordScopeService, ItemScopeService],
})
export class WordScopeModule {}
