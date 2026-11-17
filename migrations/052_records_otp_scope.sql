-- 052_records_otp_scope.sql
-- Lets the same email-OTP table serve two locks: the Menu page ('menu') and
-- editing / deleting recorded orders & payments ('records'). Idempotent.
ALTER TABLE menu_access_otps ADD COLUMN IF NOT EXISTS scope VARCHAR(20) NOT NULL DEFAULT 'menu';
