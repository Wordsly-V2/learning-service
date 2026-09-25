-- Wordsly Path items introduced that day (a subset of new_words). A Path lesson
-- paces its own introductions, so pacing exempts these from the daily new-word
-- limit. Every existing row predates Path, hence 0.
ALTER TABLE "daily_review_stat" ADD COLUMN "path_new_words" INTEGER NOT NULL DEFAULT 0;
