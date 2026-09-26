# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Wordsly learning-progress microservice (NestJS + Prisma + PostgreSQL, port 3003). Owns spaced-repetition scheduling (FSRS), daily habits/streaks, XP/levels, and learning reports. Reached through the gateway, which forwards but does not verify. Global guards in `src/auth/jwt/`: `AccessGuard` (deny-by-default; `@Public()` or a valid RS256 access token), `RolesGuard` (`@Roles('admin')` needs that role in the token's `roles` claim; no-op without the decorator) and `UserScopeGuard` (refuses any request that names a user, except an admin on an `@Roles('admin')` route; admin routes live under `/admin/learning`). Routes carry no user segment — handlers take the id from `@CurrentUser()`, i.e. the token's subject.

It stores `wordId`s that belong to vocabulary-service (no cross-DB FK); orphans are cleaned up by consuming Kafka `WORDS_DELETED_TOPIC` (`src/word-progress/word-progress.consumer.ts`). Wordsly Path items retired by a curriculum-service release arrive on `PATH_ITEMS_RETIRED_TOPIC` (`{ itemIds }`) and only their `source = PATH` progress is deleted. Both payloads are parsed strictly (non-empty uuid list) because the ids feed a cross-user `deleteMany`.

**Wordsly Path items share the same cards.** `WordProgress.source` (`VOCAB` | `PATH`, set on create, never changed) says which service a `wordId` belongs to. PATH ids are curriculum-service items (uuidv5, so they cannot collide with vocab ids). At the API it is an optional `source: 'vocab' | 'path'` on each answer and on scope DTOs. It defaults to `vocab`, so offline queues from older clients are unaffected, and a batch may mix both. `POST /word-progress/due-word-ids {source:'path'}` without `wordIds` is the Path review: it filters `source = PATH` in the query instead of taking an id list, and never returns new items, because lessons introduce those. Pacing: Path reviews share `dailyReviewLimit`, but Path items a lesson introduces are exempt from `dailyNewWordLimit`. They are counted in `DailyReviewStat.pathNewWords`, a subset of `newWords` that `computePacingBudget` subtracts.

## Commands

```bash
npm run start:dev          # watch mode on PORT (default 3003)
npm run build              # prisma generate + nest build
npm run lint               # eslint --fix
npm run test               # jest — this is the one repo with real unit tests
npx jest src/word-progress/word-progress-scheduler.spec.ts   # single file
npx jest -t "test name"    # single test by name
npx prisma migrate dev     # create/apply migrations
npm run backfill:user-level  # one-off XP backfill script
```

Config through `src/config/configuration.ts`; env validated at boot. The Kafka microservice only starts when `KAFKA_BROKERS` is set; consumers use `autoCommit: false` and must commit manually. Before the consumer subscribes, `ensureTopics` (`src/messaging/ensure-topics.ts`) creates any missing topic in `CONSUMED_TOPICS` and waits for its leader, which is what used to crash a fresh stack with UNKNOWN_TOPIC_OR_PARTITION; add every new consumed topic to that list.

## The FSRS scheduler — read this before touching word-progress

`src/word-progress/word-progress-scheduler.ts` wraps `ts-fsrs`:

- Answers arrive on the **0–5 SM-2 quality scale** (`AnswerQuality` in the DTO) and map to FSRS grades: `<3` → Again, `3` → Hard, `4` → Good, `5` → Easy. Quality ≥ 3 counts as "correct".
- Config: 90% target retention, `MAX_INTERVAL_DAYS = 365`, fuzz enabled (spreads same-day reviews), single 10-minute learning/relearning step. `interval === 0` means an intraday 10-minute step.
- **Legacy migration is load-bearing**: rows with `stability === 0` are old SM-2 rows — ease factor and state are converted on the fly (`sm2EaseToFsrsDifficulty`, `inferFsrsState`). FSRS-native rows (`stability > 0`) reconstruct the card losslessly from persisted `state/lapses/learningSteps`. Don't break either path; the scheduler spec covers both.
- Naming drift to be aware of: the `easeFactor` column/DTO field now stores **FSRS difficulty**, not SM-2 ease.
- "Mastered" = FSRS Review state with interval ≥ 21 days (`isMastered` in `src/user-level/user-level.logic.ts`).

## Write-path invariants (`src/word-progress/word-progress.service.ts`)

`recordAnswer` / `recordAnswersBulk` run one transaction that must stay atomic: upsert `WordProgress` + upsert the per-day `DailyReviewStat` aggregate (DB-side increments so concurrent sessions never lose writes) + award XP via `UserLevelService.awardXp(tx, ...)`. Bulk input is capped at `MAX_BULK_ANSWERS = 500`.

**Off-schedule practice does not reschedule** (`word-progress/off-schedule.logic.ts`). A learner can hand-pick words to practise (the difficult-words list, `saved-word` module). A *correct* answer on a Review-state card that is not yet due leaves the entire card untouched — interval, stability, state, lapses, `correctStreak` and `lastReviewedAt` all carry over — because FSRS infers stability from elapsed time and an answer given early carries no information while still pushing the due date out. A *wrong* answer takes the normal FSRS path, so the rule can only ever pull a card closer, never push it away. Cards in Learning/Relearning are exempt: intraday step repetition is how they are meant to work.

**XP and the daily goal are deduped per word per day** by the `DailyPracticedWord` ledger (PK = the rule). `recordAnswersBulk` claims each (date, word) pair up front; only claimed answers earn XP, and the claim counts are returned as `countedWordsByDate` for the client to send to daily-habit instead of counting the session itself. `totalReviews`, `correctReviews` and `DailyReviewStat` still count every answer, so accuracy is unaffected.

**Offline replay is a first-class case** — read `word-progress-replay.logic.ts` before touching the bulk path:

- Each answer may carry its own `reviewedAt` (ISO instant) so FSRS schedules from when the user answered, not from sync time. It is client data, so it is clamped: never more than 2 minutes into the future, never older than 14 days, never earlier than that card's `lastReviewedAt`. `clientDate` is reinterpreted as the client's *today* and clamped to ±1 day of the server date.
- Answers are **not** deduped by wordId. They are replayed in `reviewedAt` order with each card's state chained, so repeated reviews of one word in a single offline session advance FSRS learning steps. Only an exact `(wordId, quality, reviewedAt)` triplicate is dropped. The response is still one row per word.
- `DailyReviewStat` gets one upsert per distinct calendar date in the batch, derived from each answer's `reviewedAt` + `tzOffsetMinutes`.
- Idempotency: an optional `clientRequestId` goes through `SyncRequestService.runOnce` (`src/sync/`), which inserts the ledger row as the *first* statement of the same transaction so the primary key is the mutex. A replay returns the stored response with `replayed: true` and applies nothing. Without the id the work runs unprotected, exactly as older clients expect.
- XP has a per-day cap (`XP_ELIGIBLE_ANSWERS_PER_DAY`). Scheduling, `totalReviews` and `DailyReviewStat` are never capped — only the currency.

Streaks/habits: `recordPractice` delegates to `recordPracticeBatch`, so online and offline share one path. Streaks are **recomputed from the whole `DailyHabitDay` ledger** (`recomputeHabitFromDays`) rather than advanced from a cursor, which is the only way a backdated day can fill a gap. A gap a banked freeze pays for is written into that ledger as `frozen` day rows (`DailyHabitDay.frozen`) before the recompute runs — a frozen day bridges the chain without counting as a practice day. The recompute is therefore authoritative for the current streak (only `longest*` is floored against the stored value); do not reintroduce a floor on `streak`, which used to pin it at its stale value forever. **The freeze balance is derived the same way**: a frozen day IS the spend, so `streak_freezes` is a cache of `recomputeHabitFromDays(...).freezes`, never a running total — do not write it from anywhere else (an achievement grant used to, and the next recompute erased it). `practiceDate`/`wordsToday` always describe the client's today. Per-day consistency XP is ledgered in `DailyHabitGrant` (PK = one-shot guarantee); streak-milestone XP is owned solely by `AchievementService`.

There is **no per-review history table** — only aggregates (`DailyReviewStat`, counters on `WordProgress`). Reports are built from those aggregates; keep new stats incremental, not scan-based (`learning-report.service.ts` is the reference implementation: parallel aggregate queries, bounded row counts).

## Calling peer services

There are two peers at request time, both in `src/word-scope/`:
- `WordScopeService` → vocabulary-service: course and lesson scopes, and word ownership.
- `CurriculumScopeService` → curriculum-service: `POST /path/items/filter-published`.

`ItemScopeService.filterAccessible` splits the ids by `source` and asks both peers in parallel. It is what guards `record-answer` and the bulk sync. Failures are translated by `peer-call.ts`: a peer outage is a 503, never an empty scope.

Both clients forward **the caller's own access token** — there is no service credential. `src/http-clients/caller-context.ts` holds that token in an `AsyncLocalStorage` store installed by `app.use` in `main.ts`, and the axios request interceptor attaches it.

The consequence to design around: **outside an HTTP request there is nothing to forward**, and the client throws `MissingCallerCredentialError` rather than reaching for something stronger. Cron jobs and Kafka consumers must do their work against this service's own database — which all of them already do.

This replaced a mesh-wide shared secret (`x-service-token`) that satisfied every service's guards for every user id, so one leaked copy could act as any learner anywhere.

## Other modules

- `daily-habit` — streaks, daily goals, streak freezes (max 2: the first costs 3 consecutive goal-met days, every one after it costs 2, and no progress accrues while the bank is full — so a spend is always exactly 2 days from being refilled, and only a broken practice run re-arms the 3-day price), milestone messages. Dates are **client-local**: callers pass `clientDate`, parsed by `src/daily-habit/daily-habit-date.util.ts` — never use server-date arithmetic for habit logic.
- `user-level` — XP source of truth is `totalXp`; `level` is denormalized. Quadratic curve and per-event XP amounts live in `user-level.logic.ts`. XP awards always happen inside the caller's transaction.
- `learning-report` — period-bucketed trends + mastery snapshot + achievements, all from aggregates.
- `admin-learning` — `@Roles('admin')` under `/admin/learning`: `GET stats?from&to` (days on the learners' own calendars, default 30, max 365: active learners per day, today/7-day/30-day active, reviews, accuracy, new words, live-streak buckets, levels, weekly retention cohorts, cards by source), `POST users/summary {ids ≤100}`, `GET users/:id` (habit, level, cards per source, achievements), `GET users/:id/report` and `…/activity-calendar` (the learner's own `LearningReportService` output), `POST users/:id/reset {scope: cards|streak|xp|all, source?}` (one transaction; `streak` keeps `dailyGoal`; `all` also clears `DailyReviewStat` and `DailyPracticedWord`; settings, saved words and notifications are never touched; logs `admin_action`), `GET path-items/hardest`. "Active" = a `daily_review_stat` row with `reviews > 0` or a `daily_habit_day` row with `words_practiced > 0` (frozen days excluded). A stored streak counts only while `isStreakAlive` (last practice within 2 days), because it is recomputed on practice, not on a timer. Raw SQL: `word_progress` keeps camelCase `"wordId"`/`"userLoginId"`, every other table is snake_case. Date indexes on `daily_review_stat.review_date` and `daily_habit_day.practice_date` serve the cross-user range scans.

## Conventions

- Path alias `@/*` → `src/*`; feature modules; controllers thin, logic in pure `*.logic.ts` files where possible (they're the unit-tested surface); Prisma only via `PrismaService`; DTOs with class-validator; kebab-case folders; 4-space indent, single quotes.
- Reads that take large `wordIds` arrays are POST endpoints (body, not query) — keep that pattern for new scope-based reads.

## Database rules

- **Never use database enums** (workspace-wide rule, see `../../CLAUDE.md`): no Prisma `enum`, no `CREATE TYPE … AS ENUM`. Use `String` columns; the allowed values live in code as an `as const` list + union type and are validated at the boundary.
