-- 038_price_unit_weight.sql
-- Items sold by weight (e.g. sweets by the kg).
--
--   menu_items.price_unit      'PIECE' (default), 'KG' or '100G'.
--                              For KG / 100G items, menu_items.price is the price per kg / per 100 g.
--   order_items.weight_grams   Ordered weight of that line (NULL for normal items).
--                              order_items.unit_price already holds the amount for that weight and
--                              quantity stays 1, so quantity x unit_price totals, bills, GST and
--                              payments all keep working unchanged.
--
-- Idempotent: safe to run more than once.

ALTER TABLE menu_items  ADD COLUMN IF NOT EXISTS price_unit VARCHAR(5) NOT NULL DEFAULT 'PIECE';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS weight_grams INTEGER;

DO $$ BEGIN
  ALTER TABLE menu_items ADD CONSTRAINT chk_menu_items_price_unit CHECK (price_unit IN ('PIECE', 'KG', '100G'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE order_items ADD CONSTRAINT chk_order_items_weight CHECK (weight_grams IS NULL OR weight_grams > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
