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
      },
      $transaction: jest.fn(async (fn: (tx: typeof prisma) => unknown) =>
        fn(prisma),
      ),
    };
    service = new DailyHabitService(prisma as never);
  });

  it('returns empty state when no row exists', async () => {
    prisma.dailyHabit.findUnique.mockResolvedValue(null);

    const result = await service.getDailyHabit(userLoginId, today);

    expect(result).toEqual({
      date: today,
      wordsToday: 0,
      streak: 0,
      lastPracticeDate: null,
      goal: 10,
    });
  });

  it('resets wordsToday when practice date is not today', async () => {
    prisma.dailyHabit.findUnique.mockResolvedValue({
      userLoginId,
      wordsToday: 8,
      streak: 4,
      practiceDate: parseClientDate(yesterday),
      lastPracticeDate: parseClientDate(yesterday),
    });

    const result = await service.getDailyHabit(userLoginId, today);

    expect(result.wordsToday).toBe(0);
    expect(result.streak).toBe(4);
    expect(result.lastPracticeDate).toBe(yesterday);
  });

  it('creates a new row on first practice', async () => {
    prisma.dailyHabit.findUnique.mockResolvedValue(null);
    prisma.dailyHabit.create.mockResolvedValue({
      userLoginId,
      wordsToday: 5,
      streak: 1,
      practiceDate: parseClientDate(today),
      lastPracticeDate: parseClientDate(today),
    });

    const result = await service.recordPractice(userLoginId, {
      wordCount: 5,
      clientDate: today,
    });

    expect(prisma.dailyHabit.create).toHaveBeenCalled();
    expect(result).toEqual({
      date: today,
      wordsToday: 5,
      streak: 1,
      lastPracticeDate: today,
      goal: 10,
    });
  });

  it('continues streak when last practice was yesterday', async () => {
    prisma.dailyHabit.findUnique.mockResolvedValue({
      userLoginId,
      wordsToday: 10,
      streak: 2,
      practiceDate: parseClientDate(yesterday),
      lastPracticeDate: parseClientDate(yesterday),
    });
    prisma.dailyHabit.update.mockResolvedValue({
      userLoginId,
      wordsToday: 3,
      streak: 3,
      practiceDate: parseClientDate(today),
      lastPracticeDate: parseClientDate(today),
    });

    const result = await service.recordPractice(userLoginId, {
      wordCount: 3,
      clientDate: today,
    });

    expect(prisma.dailyHabit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ streak: 3, wordsToday: 3 }),
      }),
    );
    expect(result.streak).toBe(3);
    expect(result.wordsToday).toBe(3);
  });

  it('resets streak when gap is longer than one day', async () => {
    prisma.dailyHabit.findUnique.mockResolvedValue({
      userLoginId,
      wordsToday: 10,
      streak: 5,
      practiceDate: parseClientDate('2026-06-01'),
      lastPracticeDate: parseClientDate('2026-06-01'),
    });
    prisma.dailyHabit.update.mockResolvedValue({
      userLoginId,
      wordsToday: 2,
      streak: 1,
      practiceDate: parseClientDate(today),
      lastPracticeDate: parseClientDate(today),
    });

    const result = await service.recordPractice(userLoginId, {
      wordCount: 2,
      clientDate: today,
    });

    expect(result.streak).toBe(1);
  });
});
