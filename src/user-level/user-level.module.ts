import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { UserLevelController } from './user-level.controller';
import { UserLevelService } from './user-level.service';

@Module({
    imports: [PrismaModule],
    controllers: [UserLevelController],
    providers: [UserLevelService],
    exports: [UserLevelService],
})
export class UserLevelModule {}
