import { DailyHabitService } from './daily-habit.service';
import { parseClientDate } from './daily-habit-date.util';

describe('DailyHabitService', () => {
  const userLoginId = '01936c1e-1234-7890-abcd-ef1234567890';
  const today = '2026-06-05';
  const yesterday = '2026-06-04';

  let prisma: {
    dailyHabit: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      upsert: jest.Mock;
    };
    dailyHabitDay: {
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      upsert: jest.Mock;
      findUnique: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let service: DailyHabitService;

  beforeEach(() => {
    prisma = {
      dailyHabit: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
      },
      dailyHabitDay: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (tx: typeof prisma) => unknown) =>
        fn(prisma),
      ),
    };
    const userLevelService = {
      awardXp: jest.fn().mockResolvedValue({ leveledUp: false }),
    };
    service = new DailyHabitService(prisma as never, userLevelService as never);
  });

  it('returns empty state when no row exists', async () => {
    prisma.dailyHabit.findUnique.mockResolvedValue(null);

    const result = await service.getDailyHabit(userLoginId, today);

    expect(result.wordsToday).toBe(0);
    expect(result.streak).toBe(0);
    expect(result.goal).toBe(10);
    expect(result.recentDays).toHaveLength(7);
  });

  it('creates a new row on first practice', async () => {
    prisma.dailyHabit.findUnique.mockResolvedValue(null);
    prisma.dailyHabit.create.mockResolvedValue({
      userLoginId,
      dailyGoal: 10,
      wordsToday: 5,
      streak: 1,
      longestStreak: 1,
      goalStreak: 0,
      longestGoalStreak: 0,
      practiceDate: parseClientDate(today),
      lastPracticeDate: parseClientDate(today),
      lastGoalMetDate: null,
      totalWordsPracticed: 5,
      totalPracticeDays: 1,
    });
    prisma.dailyHabitDay.create.mockResolvedValue({});

    const result = await service.recordPractice(userLoginId, {
      wordCount: 5,
      clientDate: today,
    });

    expect(prisma.dailyHabit.create).toHaveBeenCalled();
    expect(prisma.dailyHabitDay.create).toHaveBeenCalled();
    expect(result.wordsToday).toBe(5);
    expect(result.streak).toBe(1);
  });

  it('continues streak when last practice was yesterday', async () => {
    prisma.dailyHabit.findUnique.mockResolvedValue({
      userLoginId,
      dailyGoal: 10,
      wordsToday: 10,
      streak: 2,
      longestStreak: 2,
      goalStreak: 1,
      longestGoalStreak: 1,
      practiceDate: parseClientDate(yesterday),
      lastPracticeDate: parseClientDate(yesterday),
      lastGoalMetDate: parseClientDate(yesterday),
      totalWordsPracticed: 20,
      totalPracticeDays: 2,
      streakFreezes: 0,
      lastFreezeUsedDate: null,
    });
    prisma.dailyHabitDay.upsert.mockResolvedValue({
      wordsPracticed: 3,
      goalMet: false,
    });
    prisma.dailyHabit.update.mockResolvedValue({
      userLoginId,
      dailyGoal: 10,
      wordsToday: 3,
      streak: 3,
      longestStreak: 3,
      goalStreak: 1,
      longestGoalStreak: 1,
      practiceDate: parseClientDate(today),
      lastPracticeDate: parseClientDate(today),
      lastGoalMetDate: parseClientDate(yesterday),
      totalWordsPracticed: 23,
      totalPracticeDays: 3,
    });

    const result = await service.recordPractice(userLoginId, {
      wordCount: 3,
      clientDate: today,
    });

    expect(result.streak).toBe(3);
    expect(result.wordsToday).toBe(3);
  });
});
