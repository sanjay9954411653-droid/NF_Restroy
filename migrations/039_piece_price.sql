-- 039_piece_price.sql
-- Items sold BOTH by weight and by piece (e.g. cookies: 500 per kg, or 20 per piece).
--
--   menu_items.piece_price   Optional price of ONE piece. Only used when price_unit is KG / 100G:
--                            the item can then be ordered by weight (as before) or by piece.
--                            NULL = sold by weight only.
--
-- A by-piece order line is a normal line (quantity N, unit_price = piece_price, no weight),
-- so totals, bills, GST and payments keep working unchanged.
-- Idempotent: safe to run more than once.

ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS piece_price NUMERIC(10,2);

DO $$ BEGIN
  ALTER TABLE menu_items ADD CONSTRAINT chk_menu_items_piece_price CHECK (piece_price IS NULL OR piece_price > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
