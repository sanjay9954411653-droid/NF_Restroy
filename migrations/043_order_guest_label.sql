-- 043_order_guest_label.sql
-- Lets several separate orders (guests A, B, C...) share one table.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_label VARCHAR(5);
