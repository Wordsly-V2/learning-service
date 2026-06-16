-- Persist full FSRS card state so the scheduler reconstructs the card
-- losslessly instead of inferring it on every review.
-- AlterTable
ALTER TABLE "word_progress" ADD COLUMN "fsrs_state" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "word_progress" ADD COLUMN "lapses" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "word_progress" ADD COLUMN "learning_steps" INTEGER NOT NULL DEFAULT 0;
