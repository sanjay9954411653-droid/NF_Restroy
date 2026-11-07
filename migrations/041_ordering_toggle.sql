-- 041_ordering_toggle.sql
-- Lets a restaurant switch customer ordering off (menu stays visible, ordering blocked).
-- Idempotent: additive ALTER only.

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS ordering_enabled BOOLEAN NOT NULL DEFAULT TRUE;
