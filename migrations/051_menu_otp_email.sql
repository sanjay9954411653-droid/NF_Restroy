-- 051_menu_otp_email.sql
-- The admin Menu page lock now sends its OTP by EMAIL instead of SMS.
-- OTP is required only when restaurants.menu_otp_email is set. Idempotent.

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS menu_otp_email VARCHAR(255);

-- Restaurants that already had the phone lock keep a lock: use the main admin's login email
-- (they can change it afterwards from the Menu page).
UPDATE restaurants r
SET menu_otp_email = (
    SELECT u.email FROM users u
    WHERE u.restaurant_id = r.id AND u.role = 'ADMIN' AND u.is_active = TRUE
    ORDER BY u.created_at ASC
    LIMIT 1
)
WHERE r.menu_otp_phone IS NOT NULL AND r.menu_otp_email IS NULL;
