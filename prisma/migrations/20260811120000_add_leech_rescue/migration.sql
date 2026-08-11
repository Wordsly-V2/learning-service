-- AlterTable: leech rescue baseline + a true consecutive-correct counter.
--
-- `isLeech` was recomputed on every answer as `lapses >= threshold`. FSRS
-- `lapses` only ever increments, so the flag could never clear. Measuring
-- lapses since the last rescue fixes that; `lapses_at_rescue` defaults to 0,
-- which makes the rule identical to the old one for every existing row.
--
-- `correct_streak` is needed because `repetitions` stores ts-fsrs `card.reps`,
-- which increments on failures too and therefore cannot gate a rescue.
ALTER TABLE "word_progress"
    ADD COLUMN IF NOT EXISTS "correct_streak" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "lapses_at_rescue" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "rescued_count" INTEGER NOT NULL DEFAULT 0;
