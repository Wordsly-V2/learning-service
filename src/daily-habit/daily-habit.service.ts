import { PrismaService } from '@/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { DailyHabit } from '@prisma/client';
import {
  DAILY_GOAL_WORDS,
  DailyHabitResponseDto,
  RecordDailyPracticeDto,
} from './dto/daily-habit.dto';
import {
  datesEqual,
  formatClientDate,
  parseClientDate,
  yesterdayClientDate,
} from './daily-habit-date.util';

@Injectable()
export class DailyHabitService {
  constructor(private readonly prisma: PrismaService) {}

  async getDailyHabit(
    userLoginId: string,
    clientDate: string,
  ): Promise<DailyHabitResponseDto> {
    const row = await this.prisma.dailyHabit.findUnique({
      where: { userLoginId },
    });
    return this.toResponse(row, clientDate);
  }

  async recordPractice(
    userLoginId: string,
    body: RecordDailyPracticeDto,
  ): Promise<DailyHabitResponseDto> {
    const { wordCount, clientDate } = body;
    const today = parseClientDate(clientDate);
    const yesterday = parseClientDate(yesterdayClientDate(clientDate));

    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.dailyHabit.findUnique({
        where: { userLoginId },
      });

      if (!existing) {
        return tx.dailyHabit.create({
          data: {
            userLoginId,
            wordsToday: wordCount,
            streak: 1,
            practiceDate: today,
            lastPracticeDate: today,
          },
        });
      }

      const sameDay = datesEqual(existing.practiceDate, today);
      const wordsToday = sameDay ? existing.wordsToday + wordCount : wordCount;

      let streak = existing.streak;
      const last = existing.lastPracticeDate;

      if (!last) {
        streak = 1;
      } else if (datesEqual(last, today)) {
        streak = Math.max(streak, 1);
      } else if (datesEqual(last, yesterday)) {
        streak += 1;
      } else {
        streak = 1;
      }

      return tx.dailyHabit.update({
        where: { userLoginId },
        data: {
          wordsToday,
          streak,
          practiceDate: today,
          lastPracticeDate: today,
        },
      });
    });

    return this.toResponse(updated, clientDate);
  }

  private toResponse(
    row: DailyHabit | null,
    clientDate: string,
  ): DailyHabitResponseDto {
    const today = parseClientDate(clientDate);

    if (!row) {
      return {
        date: clientDate,
        wordsToday: 0,
        streak: 0,
        lastPracticeDate: null,
        goal: DAILY_GOAL_WORDS,
      };
    }

    const sameDay = datesEqual(row.practiceDate, today);

    return {
      date: clientDate,
      wordsToday: sameDay ? row.wordsToday : 0,
      streak: row.streak,
      lastPracticeDate: row.lastPracticeDate
        ? formatClientDate(row.lastPracticeDate)
        : null,
      goal: DAILY_GOAL_WORDS,
    };
  }
}
