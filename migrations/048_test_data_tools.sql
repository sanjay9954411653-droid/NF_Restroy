-- 048_test_data_tools.sql
-- Super-admin "Clear test data" tool + per-restaurant Demo / Training mode. Idempotent.
--
--  * restaurants.demo_mode  — while ON, every new order/payment is flagged is_test
--  * orders.is_test / payments.is_test — test rows are left out of all reports
--  * data_clear_log — audit trail of every clear (who, when, what, how many)

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS demo_mode BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders      ADD COLUMN IF NOT EXISTS is_test   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE payments    ADD COLUMN IF NOT EXISTS is_test   BOOLEAN NOT NULL DEFAULT FALSE;

-- Flag new orders from the restaurant's demo_mode, and payments from their order.
-- Done in the database so every code path that creates orders/payments is covered.
CREATE OR REPLACE FUNCTION set_order_is_test() RETURNS trigger AS $$
BEGIN
  IF NEW.is_test IS NOT TRUE THEN
    NEW.is_test := COALESCE((SELECT demo_mode FROM restaurants WHERE id = NEW.restaurant_id), FALSE);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_is_test ON orders;
CREATE TRIGGER trg_orders_is_test BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION set_order_is_test();

CREATE OR REPLACE FUNCTION set_payment_is_test() RETURNS trigger AS $$
BEGIN
  IF NEW.is_test IS NOT TRUE THEN
    NEW.is_test := COALESCE((SELECT is_test FROM orders WHERE id = NEW.order_id), FALSE);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payments_is_test ON payments;
CREATE TRIGGER trg_payments_is_test BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION set_payment_is_test();

CREATE INDEX IF NOT EXISTS idx_orders_test ON orders(restaurant_id) WHERE is_test;

CREATE TABLE IF NOT EXISTS data_clear_log (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id    UUID REFERENCES restaurants(id) ON DELETE SET NULL,
    restaurant_name  VARCHAR(255) NOT NULL,
    performed_by     VARCHAR(255) NOT NULL,          -- super admin email
    filter           JSONB NOT NULL,                 -- mode, dates, include_open, extras
    counts           JSONB NOT NULL,                 -- what was actually deleted
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_data_clear_log_restaurant ON data_clear_log(restaurant_id, created_at DESC);
