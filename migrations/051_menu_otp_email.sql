-- 051_menu_otp_email.sql
-- The admin Menu page lock sends its OTP by EMAIL. Self-contained: works whether or not 050 was run. Idempotent.
-- OTP is required only when restaurants.menu_otp_email is set.

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS menu_otp_email VARCHAR(255);

CREATE TABLE IF NOT EXISTS menu_access_otps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    code_hash VARCHAR(128) NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_menu_access_otps_lookup ON menu_access_otps(restaurant_id, user_id, created_at DESC);

-- Databases that already had the old phone lock (050) keep a lock: use the main admin's login email.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'restaurants' AND column_name = 'menu_otp_phone') THEN
    UPDATE restaurants r
    SET menu_otp_email = (
        SELECT u.email FROM users u
        WHERE u.restaurant_id = r.id AND u.role = 'ADMIN' AND u.is_active = TRUE
        ORDER BY u.created_at ASC LIMIT 1
    )
    WHERE r.menu_otp_phone IS NOT NULL AND r.menu_otp_email IS NULL;
  END IF;
END $$;
