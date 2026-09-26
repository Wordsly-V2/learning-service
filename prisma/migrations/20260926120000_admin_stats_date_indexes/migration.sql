-- Admin stats read one day range across every learner; the existing indexes
-- all lead with user_login_id.
CREATE INDEX "daily_review_stat_review_date_idx" ON "daily_review_stat"("review_date");

CREATE INDEX "daily_habit_day_practice_date_idx" ON "daily_habit_day"("practice_date");
