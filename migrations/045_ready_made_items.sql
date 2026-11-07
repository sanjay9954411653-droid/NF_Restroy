-- 045_ready_made_items.sql
-- "Ready-made" menu items (samosa, cold drinks, packaged items...) skip the
-- kitchen and go straight to the waiter as "ready to serve".
--
--   menu_items.skip_kitchen     Permanent flag: this item is pre-made.
--   menu_items.ready_in_stock   Daily switch: FALSE = batch finished, so the
--                               item goes to the kitchen (to be cooked) again.
--   order_items.skip_kitchen    Snapshot taken when the order is placed, so the
--                               kitchen screen / KOT can ignore these lines even
--                               if the menu flag changes later.

ALTER TABLE menu_items  ADD COLUMN IF NOT EXISTS skip_kitchen   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE menu_items  ADD COLUMN IF NOT EXISTS ready_in_stock BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS skip_kitchen   BOOLEAN NOT NULL DEFAULT FALSE;
