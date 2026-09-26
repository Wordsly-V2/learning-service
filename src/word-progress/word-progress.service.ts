import { PrismaService } from '@/prisma/prisma.service';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { WordProgress } from '@prisma/client';
import { ItemSource, toItemSource } from '@/word-scope/item-source';
import { v7 as uuidv7 } from 'uuid';
import {
    AnswerQuality,
    BulkRecordAnswersDto,
    BulkRecordAnswersResponseDto,
    DueWordIdsResponseDto,
    GetDueWordIdsDto,
    LeechesResponseDto,
    MAX_BULK_ANSWERS,
    RecordAnswerDto,
    ScopeWordIdsDto,
    WordProgressResponseDto,
    WordProgressStatsDto,
} from './dto/word-progress.dto';
import type { Prisma } from '@prisma/client';
import {
    calculateNextReview,
    toSchedulerInput,
} from './word-progress-scheduler';
import {
    formatClientDate,
    parseClientDate,
} from '@/daily-habit/daily-habit-date.util';
import { UserLevelService } from '@/user-level/user-level.service';
import {
    applyStreakMultiplier,
    isMastered,
    streakXpMultiplier,
    xpForAnswer,
} from '@/user-level/user-level.logic';
import { effectiveGoalStreak } from '@/daily-habit/daily-habit.logic';
import { LearningSettingsService } from '@/learning-settings/learning-settings.service';
import {
    computePacingBudget,
    newWordTake,
    reviewTake,
} from './word-progress-pacing.logic';
import { nextCorrectStreak, resolveLeechState } from './leech.logic';
import { preserveSchedule, shouldPreserveSchedule } from './off-schedule.logic';
import {
    MAX_BATCH_DATES,
    prepareReplayBatch,
    resolveClientToday,
} from './word-progress-replay.logic';
import {
    SYNC_ENDPOINT_BULK_ANSWERS,
    SyncRequestService,
} from '@/sync/sync-request.service';

/**
 * Answers per calendar date that still earn XP. Deliberately an XP-only cap:
 * FSRS scheduling, totalReviews and DailyReviewStat are never capped, so a
 * genuine power user's learning is untouched and only the leaderboard currency
 * is bounded. ~3x the default dailyReviewLimit, so no honest user reaches it.
 */
export const XP_ELIGIBLE_ANSWERS_PER_DAY = 500;

interface ReviewStatDelta {
    reviews: number;
    correctReviews: number;
    newWords: number;
    /** Subset of newWords that are Wordsly Path items (see pacing logic). */
    pathNewWords: number;
    /** Subsets of reviews/correctReviews for Path items (report stats). */
    pathReviews: number;
    pathCorrectReviews: number;
}

function getOrInitDelta(
    byDate: Map<string, ReviewStatDelta>,
    date: string,
): ReviewStatDelta {
    const existing = byDate.get(date);
    if (existing) {
        return existing;
    }
    const created: ReviewStatDelta = {
        reviews: 0,
        correctReviews: 0,
        newWords: 0,
        pathNewWords: 0,
        pathReviews: 0,
        pathCorrectReviews: 0,
    };
    byDate.set(date, created);
    return created;
}

/**
 * Whether this date still has XP-eligible answers left, prior rows included.
 * Called after the current answer has been counted into `deltaByDate`, so the
 * comparison is inclusive: answer number XP_ELIGIBLE_ANSWERS_PER_DAY still pays.
 */
function isXpEligible(
    date: string,
    priorReviewsByDate: Map<string, number>,
    deltaByDate: Map<string, ReviewStatDelta>,
): boolean {
    const prior = priorReviewsByDate.get(date) ?? 0;
    const inBatch = deltaByDate.get(date)?.reviews ?? 0;
    return prior + inBatch <= XP_ELIGIBLE_ANSWERS_PER_DAY;
}

type ProgressStatsRow = Pick<
    WordProgress,
    | 'wordId'
    | 'repetitions'
    | 'nextReviewAt'
    | 'totalReviews'
    | 'correctReviews'
    | 'suspendedAt'
>;

@Injectable()
export class WordProgressService {
    private readonly logger = new Logger(WordProgressService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly userLevelService: UserLevelService,
        private readonly learningSettingsService: LearningSettingsService,
        private readonly syncRequests: SyncRequestService,
    ) {}

    /**
     * Live goal streak for XP multiplier, decayed to the client's "today" —
     * which callers must already have clamped (resolveClientToday).
     */
    private async liveGoalStreak(
        tx: Prisma.TransactionClient,
        userLoginId: string,
        clientToday: string,
    ): Promise<number> {
        const habit = await tx.dailyHabit.findUnique({
            where: { userLoginId },
            select: { goalStreak: true, lastGoalMetDate: true },
        });
        if (!habit) {
            return 0;
        }
        return effectiveGoalStreak(
            habit.goalStreak,
            habit.lastGoalMetDate,
            clientToday,
        );
    }

    /**
     * Reviews already recorded per date, so the XP cap can be applied without
     * capping the reviews themselves. Read outside the transaction — it only
     * gates a currency, so a slightly stale count is harmless.
     */
    private async readPriorReviewCounts(
        userLoginId: string,
        dates: string[],
    ): Promise<Map<string, number>> {
        if (dates.length === 0) {
            return new Map();
        }
        const rows = await this.prisma.dailyReviewStat.findMany({
            where: {
                userLoginId,
                reviewDate: { in: dates.map(parseClientDate) },
            },
            select: { reviewDate: true, reviews: true },
        });
        return new Map(
            rows.map((row) => [formatClientDate(row.reviewDate), row.reviews]),
        );
    }

    private async upsertAnswer(
        tx: Prisma.TransactionClient,
        userLoginId: string,
        wordId: string,
        quality: AnswerQuality,
        existing: WordProgress | null,
        reviewedAt: Date,
        leechConfig: { threshold: number; autoSuspend: boolean },
        source: ItemSource,
    ): Promise<WordProgress> {
        const isCorrect = quality >= AnswerQuality.CORRECT_WITH_DIFFICULTY;
        const where = {
            wordId_userLoginId: { wordId, userLoginId },
        } as const;

        // Never let a replayed answer move a card backwards in time: an offline
        // batch can arrive after an online review of the same word.
        const effectiveAt =
            existing?.lastReviewedAt && existing.lastReviewedAt > reviewedAt
                ? existing.lastReviewedAt
                : reviewedAt;

        // A correct answer on a Review-state card the learner pulled forward
        // themselves leaves the whole schedule alone — see off-schedule.logic.ts
        // for why feeding FSRS a delta_t of ~0 is worse than feeding it nothing.
        const preserved =
            existing && shouldPreserveSchedule(existing, effectiveAt, isCorrect)
                ? preserveSchedule(existing)
                : null;

        const scheduled = preserved ?? {
            ...calculateNextReview(
                quality,
                toSchedulerInput(existing, effectiveAt),
                effectiveAt,
            ),
            // Only a scheduling review moves these, so a leech cannot be
            // rescued, nor a card mastered, by re-answering it off-schedule.
            correctStreak: nextCorrectStreak(
                existing?.correctStreak ?? 0,
                isCorrect,
            ),
            lastReviewedAt: effectiveAt,
        };

        const {
            easeFactor,
            interval,
            repetitions,
            stability,
            nextReviewAt,
            state,
            lapses,
            learningSteps,
            correctStreak,
            lastReviewedAt,
        } = scheduled;

        const leech = preserved
            ? {
                  isLeech: preserved.isLeech,
                  lapsesAtRescue: preserved.lapsesAtRescue,
                  rescuedCount: preserved.rescuedCount,
              }
            : resolveLeechState({
                  wasLeech: existing?.isLeech ?? false,
                  lapsesAtRescue: existing?.lapsesAtRescue ?? 0,
                  rescuedCount: existing?.rescuedCount ?? 0,
                  lapses,
                  state,
                  correctStreak,
                  threshold: leechConfig.threshold,
              });

        // A correct answer keeps the card in rotation (clears any suspension);
        // an incorrect answer on a leech auto-suspends it when enabled. Otherwise
        // the previous suspension state is preserved.
        let suspendedAt: Date | null = existing?.suspendedAt ?? null;
        if (isCorrect) {
            suspendedAt = null;
        } else if (leechConfig.autoSuspend && leech.isLeech) {
            suspendedAt = suspendedAt ?? effectiveAt;
        }

        return tx.wordProgress.upsert({
            where,
            create: {
                id: uuidv7(),
                wordId,
                userLoginId,
                // Only on create: an id belongs to one service for good.
                source,
                easeFactor,
                interval,
                repetitions,
                stability,
                state,
                lapses,
                learningSteps,
                correctStreak,
                lastReviewedAt,
                nextReviewAt,
                totalReviews: 1,
                correctReviews: isCorrect ? 1 : 0,
                isLeech: leech.isLeech,
                lapsesAtRescue: leech.lapsesAtRescue,
                rescuedCount: leech.rescuedCount,
                suspendedAt,
            },
            update: {
                easeFactor,
                interval,
                repetitions,
                stability,
                state,
                lapses,
                learningSteps,
                correctStreak,
                lastReviewedAt,
                nextReviewAt,
                totalReviews: { increment: 1 },
                ...(isCorrect && {
                    correctReviews: { increment: 1 },
                }),
                isLeech: leech.isLeech,
                lapsesAtRescue: leech.lapsesAtRescue,
                rescuedCount: leech.rescuedCount,
                suspendedAt,
            },
        });
    }

    /**
     * Upsert the per-day review aggregate that powers the accuracy/improvement
     * chart. One atomic upsert per session (not per word) using DB-side
     * increments so concurrent sessions never lose writes.
     */
    private async recordReviewStat(
        tx: Prisma.TransactionClient,
        userLoginId: string,
        reviewDate: Date,
        delta: ReviewStatDelta,
    ): Promise<void> {
        if (delta.reviews <= 0) {
            return;
        }
        await tx.dailyReviewStat.upsert({
            where: {
                userLoginId_reviewDate: { userLoginId, reviewDate },
            },
            create: {
                userLoginId,
                reviewDate,
                reviews: delta.reviews,
                correctReviews: delta.correctReviews,
                newWords: delta.newWords,
                pathNewWords: delta.pathNewWords,
                pathReviews: delta.pathReviews,
                pathCorrectReviews: delta.pathCorrectReviews,
            },
            update: {
                reviews: { increment: delta.reviews },
                correctReviews: { increment: delta.correctReviews },
                newWords: { increment: delta.newWords },
                pathNewWords: { increment: delta.pathNewWords },
                pathReviews: { increment: delta.pathReviews },
                pathCorrectReviews: { increment: delta.pathCorrectReviews },
            },
        });
    }

    /**
     * The calendar date a review belongs to: the client's today, clamped to ±1
     * day of the server date by the same rule as the bulk path. Unclamped, a
     * single answer could file its stats (and pacing) under any day it liked.
     */
    private resolveReviewDate(clientDate: string | undefined, now: Date): Date {
        return parseClientDate(resolveClientToday(clientDate, now));
    }

    /**
     * Claim each (date, word) pair in the `DailyPracticedWord` ledger and report
     * which ones were the learner's FIRST touch of that word on that day.
     *
     * Those are the only answers that earn XP or count toward the daily goal —
     * see the model comment for why. Repeat answers still flow into
     * `totalReviews` and `DailyReviewStat`, so accuracy is unaffected; it is
     * only the two currencies that are deduped, which is what stops a
     * hand-picked saved-words session from being farmed.
     *
     * One `INSERT ... ON CONFLICT DO NOTHING RETURNING` inside the caller's
     * transaction, and the claim is whatever came back. The primary key is the
     * mutex: a session racing on the same word blocks on the other's row and
     * then inserts nothing, so it cannot also pay. (This used to read first and
     * report the rows it *meant* to insert, which let two racing sessions both
     * believe they had claimed the word.)
     *
     * @returns the `date|wordId` keys that were claimed by THIS call.
     */
    private async claimFirstPracticeOfDay(
        tx: Prisma.TransactionClient,
        userLoginId: string,
        pairs: { reviewDate: string; wordId: string }[],
    ): Promise<Set<string>> {
        const key = (reviewDate: string, wordId: string) =>
            `${reviewDate}|${wordId}`;

        // Deduped client-side too: one INSERT may not name the same key twice
        // even with ON CONFLICT, and a bulk batch repeats words by design.
        const toInsert = new Map<
            string,
            { userLoginId: string; practiceDate: Date; wordId: string }
        >();
        for (const pair of pairs) {
            toInsert.set(key(pair.reviewDate, pair.wordId), {
                userLoginId,
                practiceDate: parseClientDate(pair.reviewDate),
                wordId: pair.wordId,
            });
        }
        if (toInsert.size === 0) {
            return new Set();
        }

        const inserted = await tx.dailyPracticedWord.createManyAndReturn({
            data: [...toInsert.values()],
            skipDuplicates: true,
            select: { practiceDate: true, wordId: true },
        });

        return new Set(
            inserted.map((row) =>
                key(formatClientDate(row.practiceDate), row.wordId),
            ),
        );
    }

    async recordAnswer(
        recordAnswerDto: RecordAnswerDto & { userLoginId: string },
    ): Promise<WordProgressResponseDto> {
        const { wordId, quality, userLoginId, clientDate, source } =
            recordAnswerDto;
        const now = new Date();
        // Same clamp and same XP cap as the bulk path — otherwise the single
        // endpoint is a way around both.
        const clientToday = resolveClientToday(clientDate, now);
        const reviewDate = parseClientDate(clientToday);
        const settings =
            await this.learningSettingsService.getSettings(userLoginId);
        const priorReviewsByDate = await this.readPriorReviewCounts(
            userLoginId,
            [clientToday],
        );

        return await this.prisma.$transaction(async (tx) => {
            const existing = await tx.wordProgress.findUnique({
                where: { wordId_userLoginId: { wordId, userLoginId } },
            });
            const wordProgress = await this.upsertAnswer(
                tx,
                userLoginId,
                wordId,
                quality,
                existing,
                now,
                {
                    threshold: settings.leechThreshold,
                    autoSuspend: settings.leechAutoSuspend,
                },
                toItemSource(source),
            );
            const correct =
                quality >= AnswerQuality.CORRECT_WITH_DIFFICULTY ? 1 : 0;
            const isPath = source === 'path' ? 1 : 0;
            const delta: ReviewStatDelta = {
                reviews: 1,
                correctReviews: correct,
                newWords: existing === null ? 1 : 0,
                pathNewWords: existing === null ? isPath : 0,
                pathReviews: isPath,
                pathCorrectReviews: correct * isPath,
            };
            await this.recordReviewStat(tx, userLoginId, reviewDate, delta);
            // A word pays out at most once a day, however many times it is
            // answered — the ledger is what makes that true.
            const claimed = await this.claimFirstPracticeOfDay(
                tx,
                userLoginId,
                [{ reviewDate: clientToday, wordId }],
            );
            const baseXp =
                claimed.size === 0 ||
                !isXpEligible(
                    clientToday,
                    priorReviewsByDate,
                    new Map([[clientToday, delta]]),
                )
                    ? 0
                    : xpForAnswer({
                          quality,
                          isNewWord: existing === null,
                          wasMastered: existing
                              ? isMastered(existing.state, existing.interval)
                              : false,
                          isMastered: isMastered(
                              wordProgress.state,
                              wordProgress.interval,
                          ),
                      });
            const goalStreak = await this.liveGoalStreak(
                tx,
                userLoginId,
                clientToday,
            );
            const xp = applyStreakMultiplier(baseXp, goalStreak);
            const levelEvent = await this.userLevelService.awardXp(
                tx,
                userLoginId,
                xp,
            );
            return { ...this.mapToProgressResponse(wordProgress), levelEvent };
        });
    }

    /**
     * Record a whole session's answers in one transaction.
     *
     * Answers may have been collected offline over several days, so each one
     * carries its own `reviewedAt` and its own calendar date. They are replayed
     * in chronological order with each card's state chained, which is what makes
     * repeated reviews of the same word inside one offline session advance FSRS
     * learning steps instead of collapsing to the last grade.
     */
    async recordAnswersBulk(
        userLoginId: string,
        body: BulkRecordAnswersDto,
    ): Promise<BulkRecordAnswersResponseDto> {
        if (body.answers.length === 0) {
            return { results: [], xpMultiplier: 1, countedWordsByDate: {} };
        }
        if (body.answers.length > MAX_BULK_ANSWERS) {
            throw new BadRequestException(
                `Bulk save exceeds maximum of ${MAX_BULK_ANSWERS} answers`,
            );
        }

        const now = new Date();
        const clientToday = resolveClientToday(
            body.clientDate,
            now,
            body.tzOffsetMinutes,
        );
        const { answers, report } = prepareReplayBatch({
            answers: body.answers,
            tzOffsetMinutes: body.tzOffsetMinutes,
            clientDate: clientToday,
            now,
        });

        if (report.dates.length > MAX_BATCH_DATES) {
            throw new BadRequestException(
                `Bulk save spans ${report.dates.length} calendar dates, more than the maximum of ${MAX_BATCH_DATES}`,
            );
        }
        if (report.clampedFuture > 0 || report.clampedPast > 0) {
            this.logger.warn('offline-sync clamp', {
                userLoginId,
                answers: answers.length,
                clampedFuture: report.clampedFuture,
                clampedPast: report.clampedPast,
                inferred: report.inferred,
                dates: report.dates.length,
                spanDays: report.spanDays,
            });
        }

        const wordIds = [...new Set(answers.map((answer) => answer.wordId))];
        // Read from the request rather than threaded through the replay batch:
        // an id belongs to one service, so its source is the same on every
        // answer for it.
        const sourceByWordId = new Map(
            body.answers.map((answer) => [
                answer.wordId,
                toItemSource(answer.source),
            ]),
        );
        const settings =
            await this.learningSettingsService.getSettings(userLoginId);
        const priorReviewsByDate = await this.readPriorReviewCounts(
            userLoginId,
            report.dates,
        );

        return await this.syncRequests.runOnce<BulkRecordAnswersResponseDto>(
            userLoginId,
            body.clientRequestId,
            SYNC_ENDPOINT_BULK_ANSWERS,
            async (tx) => {
                const existingList = await tx.wordProgress.findMany({
                    where: { userLoginId, wordId: { in: wordIds } },
                });
                const stateByWordId = new Map(
                    existingList.map((progress) => [progress.wordId, progress]),
                );

                // Claimed up front for the whole batch, so a word answered three
                // times in one offline session pays once — and pays on the day
                // it was first answered, not the day the flush landed.
                const claimedKeys = await this.claimFirstPracticeOfDay(
                    tx,
                    userLoginId,
                    answers.map((answer) => ({
                        reviewDate: answer.reviewDate,
                        wordId: answer.wordId,
                    })),
                );
                // Consumed as it is spent: `claimedKeys` holds one key per
                // DISTINCT (date, word), but the loop below walks every answer,
                // and an offline session can hold three answers for one word.
                const unpaidKeys = new Set(claimedKeys);
                /** Words counted toward the daily goal, per calendar date. */
                const countedWordsByDate = new Map<string, number>();
                for (const claimed of claimedKeys) {
                    const date = claimed.slice(0, claimed.indexOf('|'));
                    countedWordsByDate.set(
                        date,
                        (countedWordsByDate.get(date) ?? 0) + 1,
                    );
                }

                // Final state per word, in first-appearance order. The response
                // stays one row per word — returning three rows for one word
                // would break the client's wordId-keyed reconciliation.
                const finalByWordId = new Map<string, WordProgress>();
                const responseOrder: string[] = [];
                const deltaByDate = new Map<string, ReviewStatDelta>();
                let baseXpEarned = 0;

                for (const answer of answers) {
                    const prior = stateByWordId.get(answer.wordId) ?? null;
                    const wordProgress = await this.upsertAnswer(
                        tx,
                        userLoginId,
                        answer.wordId,
                        answer.quality,
                        prior,
                        answer.reviewedAt,
                        {
                            threshold: settings.leechThreshold,
                            autoSuspend: settings.leechAutoSuspend,
                        },
                        sourceByWordId.get(answer.wordId) ?? ItemSource.VOCAB,
                    );

                    // Chain the state so the NEXT review of this word in the
                    // same batch sees the card this review produced.
                    stateByWordId.set(answer.wordId, wordProgress);
                    if (!finalByWordId.has(answer.wordId)) {
                        responseOrder.push(answer.wordId);
                    }
                    finalByWordId.set(answer.wordId, wordProgress);

                    const delta = getOrInitDelta(
                        deltaByDate,
                        answer.reviewDate,
                    );
                    const isPath =
                        sourceByWordId.get(answer.wordId) === ItemSource.PATH;
                    delta.reviews++;
                    if (isPath) delta.pathReviews++;
                    if (
                        answer.quality >= AnswerQuality.CORRECT_WITH_DIFFICULTY
                    ) {
                        delta.correctReviews++;
                        if (isPath) delta.pathCorrectReviews++;
                    }
                    // First-ever answer only, so a word first seen on day 1 of a
                    // multi-day batch counts as new on day 1 and nowhere else.
                    if (prior === null) {
                        delta.newWords++;
                        if (isPath) delta.pathNewWords++;
                    }

                    const payKey = `${answer.reviewDate}|${answer.wordId}`;
                    if (
                        unpaidKeys.delete(payKey) &&
                        isXpEligible(
                            answer.reviewDate,
                            priorReviewsByDate,
                            deltaByDate,
                        )
                    ) {
                        baseXpEarned += xpForAnswer({
                            quality: answer.quality,
                            isNewWord: prior === null,
                            wasMastered: prior
                                ? isMastered(prior.state, prior.interval)
                                : false,
                            isMastered: isMastered(
                                wordProgress.state,
                                wordProgress.interval,
                            ),
                        });
                    }
                }

                // One aggregate row per calendar date, so a multi-day flush
                // produces correct per-day chart rows instead of dumping
                // everything on the day it happened to sync.
                for (const [date, delta] of deltaByDate) {
                    await this.recordReviewStat(
                        tx,
                        userLoginId,
                        parseClientDate(date),
                        delta,
                    );
                }

                // One XP award for the whole session, scaled by the streak
                // multiplier live at the client's today — XP is earned when it is
                // banked, so the multiplier is deliberately not back-datable.
                const goalStreak = await this.liveGoalStreak(
                    tx,
                    userLoginId,
                    clientToday,
                );
                const xpMultiplier = streakXpMultiplier(goalStreak);
                const xpEarned = applyStreakMultiplier(
                    baseXpEarned,
                    goalStreak,
                );
                const levelEvent = await this.userLevelService.awardXp(
                    tx,
                    userLoginId,
                    xpEarned,
                );

                return {
                    results: responseOrder.map((wordId) =>
                        this.mapToProgressResponse(finalByWordId.get(wordId)!),
                    ),
                    levelEvent,
                    xpMultiplier,
                    // The client used to count the session's words itself and
                    // send that number to daily-habit. This is the server's own
                    // count, already deduped per day, so a repeat round of the
                    // same words cannot inflate the daily goal.
                    countedWordsByDate: Object.fromEntries(countedWordsByDate),
                };
            },
            {
                // Prisma's default interactive timeout is 5s, which a
                // MAX_BULK_ANSWERS-sized batch of sequential upserts will blow.
                maxWait: 10_000,
                timeout: 60_000,
                emptyOnTruncated: () => ({
                    results: [],
                    xpMultiplier: 1,
                    countedWordsByDate: {},
                }),
            },
        );
    }

    /**
     * Due and new ids for a practice session.
     *
     * The scope is either an id list (a course, lesson or explicit selection) or,
     * with `sourceScope`, every card the learner holds from one source. The
     * Wordsly Path review uses the latter: it spans the whole path, so listing
     * the ids would mean shipping thousands of them into an `IN (...)`. A source
     * scope has no new items (a Path item is introduced by its lesson, never by
     * the review queue), so `includeNew` does not apply to it.
     */
    async getDueWordIds(
        userLoginId: string,
        query: GetDueWordIdsDto,
        sourceScope?: ItemSource,
    ): Promise<DueWordIdsResponseDto> {
        const {
            // The controller resolves the scope before calling, so a list is
            // always present in practice; the default keeps the type honest.
            wordIds = [],
            limit = 20,
            newLimit,
            clientDate,
        } = query;
        const includeNew = sourceScope ? false : (query.includeNew ?? true);
        const inScope: Prisma.WordProgressWhereInput = sourceScope
            ? { source: sourceScope }
            : { wordId: { in: wordIds } };

        // Resolve today's pacing budget from settings + what's been done today.
        const now = new Date();
        const reviewDate = this.resolveReviewDate(clientDate, now);
        const [settings, todayStat] = await Promise.all([
            this.learningSettingsService.getSettings(userLoginId),
            this.prisma.dailyReviewStat.findUnique({
                where: {
                    userLoginId_reviewDate: { userLoginId, reviewDate },
                },
                select: { reviews: true, newWords: true, pathNewWords: true },
            }),
        ]);
        const budget = computePacingBudget(
            {
                dailyNewWordLimit: settings.dailyNewWordLimit,
                dailyReviewLimit: settings.dailyReviewLimit,
            },
            {
                reviews: todayStat?.reviews ?? 0,
                newWords: todayStat?.newWords ?? 0,
                pathNewWords: todayStat?.pathNewWords ?? 0,
            },
        );

        if (!sourceScope && wordIds.length === 0) {
            return {
                wordIds: [],
                dueWordIds: [],
                newWordIds: [],
                dueTotal: 0,
                newTotal: 0,
                pacing: budget,
            };
        }

        const dueLimit = reviewTake(limit, budget);

        // Every id in scope that the learner has a card for. It answers both
        // "how many are new" (the ones with no card) and "which are new" without
        // a second round trip, and it is the same snapshot the due query runs
        // against, so the two halves of the session cannot disagree.
        const [progressRows, dueTotal] = await Promise.all([
            // Only needed to find new ids, which a source scope never has.
            sourceScope
                ? Promise.resolve<{ wordId: string }[]>([])
                : this.prisma.wordProgress.findMany({
                      where: { userLoginId, wordId: { in: wordIds } },
                      select: { wordId: true },
                  }),
            this.prisma.wordProgress.count({
                where: {
                    userLoginId,
                    nextReviewAt: { lte: now },
                    suspendedAt: null,
                    ...inScope,
                },
            }),
        ]);
        const progressSet = new Set(progressRows.map((p) => p.wordId));
        const newTotal = wordIds.filter((id) => !progressSet.has(id)).length;

        // Most-overdue first: the words closest to being forgotten are the ones
        // whose review matters most, and the DB does the sort + limit for us.
        // Suspended cards are withheld from selection.
        //
        // wordId breaks ties. Cards imported or seeded together share a
        // nextReviewAt to the millisecond, and `ORDER BY` on that alone leaves
        // the rows the `take` keeps up to the planner — so the same request
        // twice could return two different sets of "the 15 most overdue".
        const dueRows =
            dueLimit > 0
                ? await this.prisma.wordProgress.findMany({
                      where: {
                          userLoginId,
                          nextReviewAt: { lte: now },
                          suspendedAt: null,
                          ...inScope,
                      },
                      select: { wordId: true },
                      orderBy: [{ nextReviewAt: 'asc' }, { wordId: 'asc' }],
                      take: dueLimit,
                  })
                : [];

        const dueIds = dueRows.map((r) => r.wordId);

        const newTake = includeNew
            ? newWordTake(limit, dueIds.length, budget, newLimit)
            : 0;

        // Caller order decides which new words come first. It is the scope order
        // from vocabulary-service — course, then lesson, then word — so a
        // learner works through one course's lessons in order instead of being
        // handed the alphabetically-first word of every course at once.
        const newIds =
            newTake > 0
                ? wordIds.filter((id) => !progressSet.has(id)).slice(0, newTake)
                : [];

        return {
            wordIds: [...dueIds, ...newIds],
            dueWordIds: dueIds,
            newWordIds: newIds,
            dueTotal,
            newTotal,
            pacing: budget,
        };
    }

    /**
     * Ids of every card the learner holds from one source, for scope-wide reads
     * (Path stats and leeches). Bounded by what one learner can have studied.
     */
    async getCardIdsBySource(
        userLoginId: string,
        source: ItemSource,
    ): Promise<string[]> {
        const rows = await this.prisma.wordProgress.findMany({
            where: { userLoginId, source },
            select: { wordId: true },
        });
        return rows.map((row) => row.wordId);
    }

    /** Leech cards within a scope, most-lapsed first. */
    async getLeeches(
        userLoginId: string,
        wordIds: string[],
    ): Promise<LeechesResponseDto> {
        if (wordIds.length === 0) {
            return { leeches: [] };
        }
        const rows = await this.prisma.wordProgress.findMany({
            where: { userLoginId, isLeech: true, wordId: { in: wordIds } },
            orderBy: { lapses: 'desc' },
        });
        return {
            leeches: rows.map((r) => ({
                wordId: r.wordId,
                lapses: r.lapses,
                state: r.state,
                totalReviews: r.totalReviews,
                correctReviews: r.correctReviews,
                successRate:
                    r.totalReviews > 0
                        ? Math.round(
                              (r.correctReviews / r.totalReviews) * 100 * 10,
                          ) / 10
                        : 0,
                suspendedAt: r.suspendedAt,
                nextReviewAt: r.nextReviewAt,
            })),
        };
    }

    /** Clear a card's suspension so it re-enters review selection. */
    async unsuspendWord(userLoginId: string, wordId: string): Promise<void> {
        await this.prisma.wordProgress.updateMany({
            where: { userLoginId, wordId },
            data: { suspendedAt: null },
        });
    }

    private computeStatsFromProgresses(
        totalWords: number,
        wordProgresses: ProgressStatsRow[],
        now: Date,
    ): WordProgressStatsDto {
        const newWords = totalWords - wordProgresses.length;
        let learningWords = 0;
        let reviewWords = 0;
        let dueToday = 0;
        let totalReviews = 0;
        let totalCorrect = 0;

        for (const progress of wordProgresses) {
            totalReviews += progress.totalReviews;
            totalCorrect += progress.correctReviews;
            if (progress.repetitions < 3) {
                learningWords++;
            } else {
                reviewWords++;
            }
            if (progress.nextReviewAt <= now && progress.suspendedAt == null) {
                dueToday++;
            }
        }

        const overallSuccessRate =
            totalReviews > 0
                ? Math.round((totalCorrect / totalReviews) * 100 * 10) / 10
                : 0;

        return {
            totalWords,
            newWords,
            learningWords,
            reviewWords,
            dueToday,
            overallSuccessRate,
        };
    }

    /** Stats only need a handful of columns — avoid hauling full rows into memory. */
    private async getProgressForWordIds(
        userLoginId: string,
        wordIds: string[],
    ): Promise<ProgressStatsRow[]> {
        if (wordIds.length === 0) {
            return [];
        }
        return this.prisma.wordProgress.findMany({
            where: { userLoginId, wordId: { in: wordIds } },
            select: {
                wordId: true,
                repetitions: true,
                nextReviewAt: true,
                totalReviews: true,
                correctReviews: true,
                suspendedAt: true,
            },
        });
    }

    async getProgressStats(
        userLoginId: string,
        wordIds: string[],
    ): Promise<WordProgressStatsDto> {
        const now = new Date();
        const wordProgresses = await this.getProgressForWordIds(
            userLoginId,
            wordIds,
        );

        return this.computeStatsFromProgresses(
            wordIds.length,
            wordProgresses,
            now,
        );
    }

    async getProgressStatsMapByScopes(
        userLoginId: string,
        scopes: ScopeWordIdsDto[],
    ): Promise<Map<string, WordProgressStatsDto>> {
        if (scopes.length === 0) return new Map();
        const now = new Date();

        const allWordIds = scopes.flatMap((scope) => scope.wordIds);
        const progressList = await this.getProgressForWordIds(
            userLoginId,
            allWordIds,
        );
        const progressByWordId = new Map(
            progressList.map((p) => [p.wordId, p]),
        );

        const result = new Map<string, WordProgressStatsDto>();
        for (const scope of scopes) {
            const progresses = scope.wordIds
                .map((wordId) => progressByWordId.get(wordId))
                .filter((p): p is ProgressStatsRow => p != null);
            result.set(
                scope.scopeId,
                this.computeStatsFromProgresses(
                    scope.wordIds.length,
                    progresses,
                    now,
                ),
            );
        }
        return result;
    }

    async getWordProgress(
        userLoginId: string,
        wordId: string,
    ): Promise<WordProgressResponseDto | null> {
        const progress = await this.prisma.wordProgress.findUnique({
            where: {
                wordId_userLoginId: { wordId, userLoginId },
            },
        });

        return progress ? this.mapToProgressResponse(progress) : null;
    }

    async getProgressMapByWordIds(
        userLoginId: string,
        wordIds: string[],
    ): Promise<Map<string, WordProgressResponseDto | null>> {
        if (wordIds.length === 0) {
            return new Map();
        }
        const progressList = await this.prisma.wordProgress.findMany({
            where: { userLoginId, wordId: { in: wordIds } },
        });
        const progressByWordId = new Map(
            progressList.map((p) => [p.wordId, p]),
        );
        const result = new Map<string, WordProgressResponseDto | null>();
        for (const wordId of wordIds) {
            const progress = progressByWordId.get(wordId);
            result.set(
                wordId,
                progress ? this.mapToProgressResponse(progress) : null,
            );
        }
        return result;
    }

    async resetProgress(userLoginId: string, wordId: string): Promise<void> {
        await this.prisma.wordProgress.deleteMany({
            where: { wordId, userLoginId },
        });
    }

    async deleteProgressForWords(wordIds: string[]): Promise<void> {
        // An empty or missing list must never reach deleteMany: `{ in: undefined }`
        // is treated as no filter and would drop every user's progress.
        if (!Array.isArray(wordIds) || wordIds.length === 0) {
            return;
        }
        await this.prisma.wordProgress.deleteMany({
            where: { wordId: { in: wordIds } },
        });
    }

    /**
     * Drops every learner's progress for retired Wordsly Path items. Only Path
     * cards: an id is never both, but the source filter keeps a bad message
     * from touching vocabulary progress at all.
     */
    async deletePathProgressForItems(itemIds: string[]): Promise<void> {
        // Same guard as deleteProgressForWords: `{ in: undefined }` is no filter.
        if (!Array.isArray(itemIds) || itemIds.length === 0) {
            return;
        }
        await this.prisma.wordProgress.deleteMany({
            where: { wordId: { in: itemIds }, source: ItemSource.PATH },
        });
    }

    async resetProgressBulk(
        userLoginId: string,
        wordIds: string[],
    ): Promise<{ count: number }> {
        if (wordIds.length === 0) {
            return { count: 0 };
        }

        const result = await this.prisma.wordProgress.deleteMany({
            where: {
                userLoginId,
                wordId: { in: wordIds },
            },
        });
        return { count: result.count };
    }

    private mapToProgressResponse(
        progress: WordProgress,
    ): WordProgressResponseDto {
        const successRate =
            progress.totalReviews > 0
                ? Math.round(
                      (progress.correctReviews / progress.totalReviews) *
                          100 *
                          10,
                  ) / 10
                : 0;

        return {
            id: progress.id,
            wordId: progress.wordId,
            userLoginId: progress.userLoginId,
            easeFactor: progress.easeFactor,
            interval: progress.interval,
            repetitions: progress.repetitions,
            lastReviewedAt: progress.lastReviewedAt ?? undefined,
            nextReviewAt: progress.nextReviewAt,
            totalReviews: progress.totalReviews,
            correctReviews: progress.correctReviews,
            successRate,
            state: progress.state,
            lapses: progress.lapses,
            isLeech: progress.isLeech,
            suspendedAt: progress.suspendedAt,
        };
    }
}
