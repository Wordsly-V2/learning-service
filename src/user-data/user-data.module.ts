import { PrismaModule } from '@/prisma/prisma.module';
import { Module } from '@nestjs/common';
import { UserDataService } from './user-data.service';
import { UserDeletedConsumer } from './user-deleted.consumer';

/** Account-level data handling: the purge after an account is deleted. */
@Module({
    imports: [PrismaModule],
    controllers: [UserDeletedConsumer],
    providers: [UserDataService],
})
export class UserDataModule {}
