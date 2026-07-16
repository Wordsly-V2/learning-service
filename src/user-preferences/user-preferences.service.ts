import { PrismaService } from '@/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
    PreferencesBlob,
    UserPreferencesResponseDto,
} from './dto/user-preferences.dto';

@Injectable()
export class UserPreferencesService {
    constructor(private readonly prisma: PrismaService) {}

    /** Read the user's preferences blob, defaulting to {} without creating a row. */
    async getPreferences(
        userLoginId: string,
    ): Promise<UserPreferencesResponseDto> {
        const row = await this.prisma.userPreferences.findUnique({
            where: { userLoginId },
        });
        return { preferences: (row?.preferences as PreferencesBlob) ?? {} };
    }

    /**
     * Shallow-merge `patch` into the stored blob (last-write-wins per top-level
     * key), lazily creating the row. Concurrent devices race at the key level,
     * which is the intended sync semantics for personal settings.
     */
    async updatePreferences(
        userLoginId: string,
        patch: PreferencesBlob,
    ): Promise<UserPreferencesResponseDto> {
        const existing = await this.prisma.userPreferences.findUnique({
            where: { userLoginId },
        });
        const merged: PreferencesBlob = {
            ...((existing?.preferences as PreferencesBlob) ?? {}),
            ...patch,
        };
        const row = await this.prisma.userPreferences.upsert({
            where: { userLoginId },
            create: {
                userLoginId,
                preferences: merged as Prisma.InputJsonValue,
            },
            update: { preferences: merged as Prisma.InputJsonValue },
        });
        return { preferences: row.preferences as PreferencesBlob };
    }
}
