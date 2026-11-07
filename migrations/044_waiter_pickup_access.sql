-- 044_waiter_pickup_access.sql
-- Lets a table-restricted waiter also be given pick-up (no table) orders.
-- Restricted = has assigned tables OR pickup_assigned. Default FALSE keeps existing accounts unchanged.
ALTER TABLE users ADD COLUMN IF NOT EXISTS pickup_assigned BOOLEAN NOT NULL DEFAULT FALSE;
