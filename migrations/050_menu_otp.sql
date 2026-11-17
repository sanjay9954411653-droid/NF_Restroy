-- 050_menu_otp.sql
-- Opening / changing the admin Menu page requires an OTP sent to the main admin's phone.
-- OTP is required only when restaurants.menu_otp_phone is set. Idempotent.

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS menu_otp_phone VARCHAR(20);

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
