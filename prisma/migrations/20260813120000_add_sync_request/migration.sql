-- CreateTable: idempotency ledger for offline-sync flushes.
--
-- Offline clients queue practice answers and retry the flush until it succeeds.
-- A request that reaches the server but whose response is lost was previously
-- replayed as a second FSRS update and a second XP award. The client now mints
-- one `client_request_id` per flush and reuses it on every retry; the primary
-- key is the mutex, so a duplicate loses on a unique violation and the whole
-- transaction rolls back having changed nothing.
--
-- `response` is nullable on purpose: it is filled at the end of the committing
-- transaction, so a concurrent duplicate that arrives mid-flight sees NULL and
-- is told to retry rather than being handed an empty body.
--
-- Additive: no existing table is touched, so an older service build runs
-- unaffected against this schema.
CREATE TABLE IF NOT EXISTS "sync_request" (
    "user_login_id"     UUID        NOT NULL,
    "client_request_id" UUID        NOT NULL,
    "endpoint"          TEXT        NOT NULL,
    "response"          JSONB,
    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_request_pkey" PRIMARY KEY ("user_login_id", "client_request_id")
);

-- Keeps the daily retention sweep cheap.
CREATE INDEX IF NOT EXISTS "sync_request_created_at_idx" ON "sync_request" ("created_at");
