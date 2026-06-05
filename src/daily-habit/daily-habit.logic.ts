import {
  datesEqual,
  formatClientDate,
  parseClientDate,
  yesterdayClientDate,
} from './daily-habit-date.util';

/** Returns the next practice streak after today's session. */
export function nextPracticeStreak(
  currentStreak: number,
  lastPracticeDate: Date | null,
  today: Date,
  yesterday: Date,
): number {
  if (!lastPracticeDate) {
    return 1;
  }
  if (datesEqual(lastPracticeDate, today)) {
    return Math.max(currentStreak, 1);
  }
  if (datesEqual(lastPracticeDate, yesterday)) {
    return currentStreak + 1;
  }
  return 1;
}

export function isGoalMet(words: number, goal: number): boolean {
  return words >= goal;
}

/** Goal streak shown to the user; breaks when last goal met is older than yesterday. */
export function effectiveGoalStreak(
  goalStreak: number,
  lastGoalMetDate: Date | null,
  clientDate: string,
): number {
  if (!lastGoalMetDate || goalStreak <= 0) {
    return 0;
  }
  const today = parseClientDate(clientDate);
  const yesterday = parseClientDate(yesterdayClientDate(clientDate));
  if (datesEqual(lastGoalMetDate, today) || datesEqual(lastGoalMetDate, yesterday)) {
    return goalStreak;
  }
  return 0;
}

export function nextGoalStreak(
  currentGoalStreak: number,
  lastGoalMetDate: Date | null,
  today: Date,
  yesterday: Date,
  goalMetToday: boolean,
): { goalStreak: number; lastGoalMetDate: Date | null } {
  if (!goalMetToday) {
    return { goalStreak: currentGoalStreak, lastGoalMetDate };
  }
  if (!lastGoalMetDate) {
    return { goalStreak: 1, lastGoalMetDate: today };
  }
  if (datesEqual(lastGoalMetDate, today)) {
    return { goalStreak: currentGoalStreak, lastGoalMetDate };
  }
  if (datesEqual(lastGoalMetDate, yesterday)) {
    return { goalStreak: currentGoalStreak + 1, lastGoalMetDate: today };
  }
  return { goalStreak: 1, lastGoalMetDate: today };
}

export function addClientDays(date: string, delta: number): string {
  const parsed = parseClientDate(date);
  parsed.setUTCDate(parsed.getUTCDate() + delta);
  return formatClientDate(parsed);
}

export function lastNDays(endDate: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    addClientDays(endDate, index - (count - 1)),
  );
}

export function habitMotivation(params: {
  goalMetToday: boolean;
  wordsToday: number;
  goal: number;
  streak: number;
  goalStreak: number;
  wordsRemaining: number;
}): string {
  const { goalMetToday, wordsToday, goal, streak, goalStreak, wordsRemaining } =
    params;

  if (goalMetToday && goalStreak >= 7) {
    return `${goalStreak}-day goal streak — you're on fire!`;
  }
  if (goalMetToday) {
    return "Daily goal complete. Keep the momentum going!";
  }
  if (wordsToday > 0 && wordsRemaining <= 3) {
    return `Almost there — ${wordsRemaining} more word${wordsRemaining === 1 ? "" : "s"} to hit your goal.`;
  }
  if (streak >= 3) {
    return `${streak}-day practice streak. ${wordsRemaining} words left today.`;
  }
  return `Practice ${goal} words a day to build your streak.`;
}
