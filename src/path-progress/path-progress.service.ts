import { Injectable } from '@nestjs/common';
import { AchievementService } from '@/achievement/achievement.service';
import type { UnlockedAchievementDto } from '@/achievement/dto/achievement.dto';
import { computePathAchievements } from '@/learning-report/learning-report.logic';
import { PrismaService } from '@/prisma/prisma.service';
import type { PathProgressEvent } from './path-progress.logic';

/**
 * Applies curriculum-service's Wordsly Path totals: keeps the newest in
 * `PathProgressTotals` (for the report) and unlocks Path achievements.
 */
@Injectable()
export class PathProgressService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly achievements: AchievementService,
    ) {}

    /**
     * Idempotent: a redelivered message rewrites the same totals, and an
     * achievement is inserted once (its primary key), so its XP is paid once.
     * An older message arriving late leaves the stored totals alone but may
     * still unlock: the learner did reach those totals at the time.
     */
    async apply(event: PathProgressEvent): Promise<UnlockedAchievementDto[]> {
        const {
            userLoginId,
            lessonsCompleted,
            unitsCompleted,
            stagesCompleted,
            occurredAt,
        } = event;
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`
                INSERT INTO path_progress_totals (
                    user_login_id, lessons_completed, units_completed,
                    stages_completed, reported_at, updated_at
                )
                VALUES (
                    ${userLoginId}::uuid, ${lessonsCompleted}, ${unitsCompleted},
                    ${stagesCompleted}, ${occurredAt}, now()
                )
                ON CONFLICT (user_login_id) DO UPDATE SET
                    lessons_completed = EXCLUDED.lessons_completed,
                    units_completed = EXCLUDED.units_completed,
                    stages_completed = EXCLUDED.stages_completed,
                    reported_at = EXCLUDED.reported_at,
                    updated_at = now()
                WHERE path_progress_totals.reported_at <= EXCLUDED.reported_at`;
            return this.achievements.detectAndUnlock(
                tx,
                userLoginId,
                computePathAchievements(event),
            );
        });
    }
}
