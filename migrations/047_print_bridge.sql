-- 047_print_bridge.sql
-- Print bridge: lets a small program on a PC at the restaurant (the "bridge")
-- pick up print jobs (KOTs, receipts) from the server and send them to the
-- thermal printers on the local network / USB. Idempotent.

CREATE TABLE IF NOT EXISTS print_bridge_settings (
    restaurant_id UUID PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
    enabled       BOOLEAN NOT NULL DEFAULT FALSE,
    auto_kot      BOOLEAN NOT NULL DEFAULT TRUE,   -- print a KOT automatically when an order is placed
    bridge_key    TEXT NOT NULL,                   -- secret the bridge program uses to log in
    last_seen_at  TIMESTAMP,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_print_bridge_key ON print_bridge_settings(bridge_key);

CREATE TABLE IF NOT EXISTS print_jobs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    target        TEXT NOT NULL CHECK (target IN ('KOT', 'BILL')),  -- which printer: kitchen / receipt
    kind          TEXT NOT NULL CHECK (kind IN ('KOT', 'RAW')),     -- KOT = structured, RAW = ready ESC/POS bytes
    payload       JSONB NOT NULL,
    status        TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CLAIMED', 'PRINTED', 'FAILED')),
    attempts      INTEGER NOT NULL DEFAULT 0,
    error         TEXT,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    claimed_at    TIMESTAMP,
    printed_at    TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_print_jobs_pending ON print_jobs(restaurant_id, status, created_at);
