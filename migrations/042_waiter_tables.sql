-- 042_waiter_tables.sql
-- Restricts a waiter account to specific tables.
-- A WAITER with no rows here keeps access to every table (so existing accounts are unaffected).
-- Idempotent.

CREATE TABLE IF NOT EXISTS waiter_tables (
    user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES restaurant_tables(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, table_id)
);

CREATE INDEX IF NOT EXISTS idx_waiter_tables_table ON waiter_tables(table_id);
