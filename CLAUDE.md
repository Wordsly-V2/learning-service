# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Wordsly learning-progress microservice (NestJS + Prisma + PostgreSQL, port 3003). Owns spaced-repetition scheduling (FSRS), daily habits/streaks, XP/levels, and learning reports. Internal-only: controllers are guarded by `InternalServiceGuard` — only the api-gateway calls in. It stores `wordId`s that belong to vocabulary-service (no cross-DB FK); orphans are cleaned up by consuming Kafka `WORDS_DELETED_TOPIC` (`src/word-progress/word-progress.consumer.ts`).

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

Config through `src/config/configuration.ts`; env validated at boot. The Kafka microservice only starts when `KAFKA_BROKERS` is set; consumers use `autoCommit: false` and must commit manually.

## The FSRS scheduler — read this before touching word-progress

`src/word-progress/word-progress-scheduler.ts` wraps `ts-fsrs`:

- Answers arrive on the **0–5 SM-2 quality scale** (`AnswerQuality` in the DTO) and map to FSRS grades: `<3` → Again, `3` → Hard, `4` → Good, `5` → Easy. Quality ≥ 3 counts as "correct".
- Config: 90% target retention, `MAX_INTERVAL_DAYS = 365`, fuzz enabled (spreads same-day reviews), single 10-minute learning/relearning step. `interval === 0` means an intraday 10-minute step.
- **Legacy migration is load-bearing**: rows with `stability === 0` are old SM-2 rows — ease factor and state are converted on the fly (`sm2EaseToFsrsDifficulty`, `inferFsrsState`). FSRS-native rows (`stability > 0`) reconstruct the card losslessly from persisted `state/lapses/learningSteps`. Don't break either path; the scheduler spec covers both.
- Naming drift to be aware of: the `easeFactor` column/DTO field now stores **FSRS difficulty**, not SM-2 ease.
- "Mastered" = FSRS Review state with interval ≥ 21 days (`isMastered` in `src/user-level/user-level.logic.ts`).

## Write-path invariants (`src/word-progress/word-progress.service.ts`)

`recordAnswer` / `recordAnswersBulk` run one transaction that must stay atomic: upsert `WordProgress` + upsert the per-day `DailyReviewStat` aggregate (DB-side increments so concurrent sessions never lose writes) + award XP via `UserLevelService.awardXp(tx, ...)`. Bulk input is deduped by wordId (frontend already sends one worst-quality answer per word) and capped at `MAX_BULK_ANSWERS = 200`.

There is **no per-review history table** — only aggregates (`DailyReviewStat`, counters on `WordProgress`). Reports are built from those aggregates; keep new stats incremental, not scan-based (`learning-report.service.ts` is the reference implementation: parallel aggregate queries, bounded row counts).

## Other modules

- `daily-habit` — streaks, daily goals, streak freezes (earned at 3- and 5-day goal streaks, max 2), milestone messages. Dates are **client-local**: callers pass `clientDate`, parsed by `src/daily-habit/daily-habit-date.util.ts` — never use server-date arithmetic for habit logic.
- `user-level` — XP source of truth is `totalXp`; `level` is denormalized. Quadratic curve and per-event XP amounts live in `user-level.logic.ts`. XP awards always happen inside the caller's transaction.
- `learning-report` — period-bucketed trends + mastery snapshot + achievements, all from aggregates.

## Conventions

- Path alias `@/*` → `src/*`; feature modules; controllers thin, logic in pure `*.logic.ts` files where possible (they're the unit-tested surface); Prisma only via `PrismaService`; DTOs with class-validator; kebab-case folders; 4-space indent, single quotes.
- Reads that take large `wordIds` arrays are POST endpoints (body, not query) — keep that pattern for new scope-based reads.
