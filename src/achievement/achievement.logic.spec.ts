import {
    computeAchievements,
    computePathAchievements,
} from '@/learning-report/learning-report.logic';
import { achievementReward, diffNewlyUnlocked } from './achievement.logic';

describe('achievement logic', () => {
    it('diffs any domain of badges against what is recorded', () => {
        const path = computePathAchievements({
            lessonsCompleted: 10,
            unitsCompleted: 0,
            stagesCompleted: 0,
        });
        expect(diffNewlyUnlocked(path, new Set(['lessons-1']))).toEqual([
            'lessons-10',
        ]);
        const habits = computeAchievements({
            longestStreak: 0,
            totalWordsPracticed: 0,
            totalPracticeDays: 0,
        });
        expect(diffNewlyUnlocked(habits, new Set())).toEqual([]);
    });

    it('rewards Path milestones by tier, capped at 300 XP', () => {
        expect(achievementReward('lessons-1')).toEqual({ xp: 26 });
        expect(achievementReward('units-5')).toEqual({ xp: 60 });
        expect(achievementReward('stages-1')).toEqual({ xp: 100 });
        expect(achievementReward('stages-6')).toEqual({ xp: 300 });
        expect(achievementReward('lessons-1000')).toEqual({ xp: 300 });
    });
});
