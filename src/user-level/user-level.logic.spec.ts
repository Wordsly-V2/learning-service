import {
    computeLevelProgress,
    isMastered,
    levelFromXp,
    rankForLevel,
    xpForAnswer,
    xpToReachLevel,
    XP_CORRECT,
    XP_MASTERED,
    XP_NEW_WORD,
    XP_PER_REVIEW,
    XP_PERFECT,
} from './user-level.logic';

describe('xpToReachLevel', () => {
    it('matches the documented thresholds', () => {
        expect(xpToReachLevel(1)).toBe(0);
        expect(xpToReachLevel(2)).toBe(100);
        expect(xpToReachLevel(3)).toBe(300);
        expect(xpToReachLevel(4)).toBe(600);
        expect(xpToReachLevel(5)).toBe(1000);
        expect(xpToReachLevel(10)).toBe(4500);
        expect(xpToReachLevel(20)).toBe(19000);
    });

    it('treats levels <= 1 as zero', () => {
        expect(xpToReachLevel(0)).toBe(0);
        expect(xpToReachLevel(-3)).toBe(0);
    });
});

describe('levelFromXp', () => {
    it('floors to level 1 at or below zero XP', () => {
        expect(levelFromXp(0)).toBe(1);
        expect(levelFromXp(-50)).toBe(1);
        expect(levelFromXp(99)).toBe(1);
    });

    it('is the exact inverse of xpToReachLevel at each threshold', () => {
        for (let level = 1; level <= 60; level++) {
            const floor = xpToReachLevel(level);
            expect(levelFromXp(floor)).toBe(level);
        }
    });

    it('does not advance one XP before a threshold', () => {
        for (let level = 2; level <= 60; level++) {
            const floor = xpToReachLevel(level);
            expect(levelFromXp(floor - 1)).toBe(level - 1);
        }
    });
});

describe('rankForLevel', () => {
    it('maps levels onto the correct rank tier', () => {
        expect(rankForLevel(1)).toBe('Novice');
        expect(rankForLevel(4)).toBe('Novice');
        expect(rankForLevel(5)).toBe('Apprentice');
        expect(rankForLevel(9)).toBe('Apprentice');
        expect(rankForLevel(10)).toBe('Skilled');
        expect(rankForLevel(20)).toBe('Expert');
        expect(rankForLevel(35)).toBe('Master');
        expect(rankForLevel(50)).toBe('Grandmaster');
        expect(rankForLevel(999)).toBe('Grandmaster');
    });
});

describe('computeLevelProgress', () => {
    it('reports a fresh user at level 1 with no progress', () => {
        const p = computeLevelProgress(0);
        expect(p).toMatchObject({
            level: 1,
            rank: 'Novice',
            totalXp: 0,
            currentLevelXp: 0,
            xpForThisLevel: 100,
            xpToNextLevel: 100,
            progress: 0,
        });
    });

    it('reports mid-level progress relative to the current level span', () => {
        // Level 2 spans 100..300 (200 XP). 150 XP = 50 into level 2.
        const p = computeLevelProgress(150);
        expect(p.level).toBe(2);
        expect(p.currentLevelXp).toBe(50);
        expect(p.xpForThisLevel).toBe(200);
        expect(p.xpToNextLevel).toBe(150);
        expect(p.progress).toBe(25);
    });

    it('is at 0 progress exactly on a level boundary', () => {
        const p = computeLevelProgress(300);
        expect(p.level).toBe(3);
        expect(p.currentLevelXp).toBe(0);
        expect(p.progress).toBe(0);
    });

    it('clamps negative XP to zero', () => {
        expect(computeLevelProgress(-10).totalXp).toBe(0);
    });
});

describe('isMastered', () => {
    it('requires Review state and a long-enough interval', () => {
        expect(isMastered(2, 21)).toBe(true);
        expect(isMastered(2, 30)).toBe(true);
        expect(isMastered(2, 20)).toBe(false);
        expect(isMastered(1, 60)).toBe(false);
    });
});

describe('xpForAnswer', () => {
    const base = { isNewWord: false, wasMastered: false, isMastered: false };

    it('awards the review + correct + perfect stack for a perfect answer', () => {
        expect(xpForAnswer({ ...base, quality: 5 })).toBe(
            XP_PER_REVIEW + XP_CORRECT + XP_PERFECT,
        );
    });

    it('awards review only for a wrong answer', () => {
        expect(xpForAnswer({ ...base, quality: 1 })).toBe(XP_PER_REVIEW);
    });

    it('awards correct (not perfect) at quality 3 and 4', () => {
        expect(xpForAnswer({ ...base, quality: 3 })).toBe(
            XP_PER_REVIEW + XP_CORRECT,
        );
        expect(xpForAnswer({ ...base, quality: 4 })).toBe(
            XP_PER_REVIEW + XP_CORRECT,
        );
    });

    it('adds the new-word bonus on first sight', () => {
        expect(xpForAnswer({ ...base, quality: 4, isNewWord: true })).toBe(
            XP_PER_REVIEW + XP_CORRECT + XP_NEW_WORD,
        );
    });

    it('adds the mastery bonus only on the crossing into mastery', () => {
        expect(
            xpForAnswer({ ...base, quality: 5, isMastered: true }),
        ).toBe(XP_PER_REVIEW + XP_CORRECT + XP_PERFECT + XP_MASTERED);
        // Already mastered before this answer -> no repeat bonus.
        expect(
            xpForAnswer({
                ...base,
                quality: 5,
                wasMastered: true,
                isMastered: true,
            }),
        ).toBe(XP_PER_REVIEW + XP_CORRECT + XP_PERFECT);
    });
});
