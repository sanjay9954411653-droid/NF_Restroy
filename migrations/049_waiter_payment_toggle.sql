-- 049_waiter_payment_toggle.sql
-- Admin switch: can waiters collect payment?
--   TRUE  (default) = waiters can collect payment, as today
--   FALSE           = only reception / admin can; waiters can still take orders,
--                     print the bill and serve, but not take payment.
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS waiter_can_collect_payment BOOLEAN NOT NULL DEFAULT TRUE;
