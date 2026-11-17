# Menu lock: OTP by email

The admin **Menu** page asks for a 6-digit code before it opens. The code now goes to an **email address** (not a phone).

## 1. Run the migration (once)
Railway → Postgres service → Data → Query → paste `migrations/051_menu_otp_email.sql` → Run.
Restaurants that already had the phone lock keep a lock: their main admin's login email is used automatically.

## 2. Set up the email sender (once)
The server needs an email service to send the code. Easiest without your own domain: **Brevo** (free, 300 emails/day).
1. Sign up at brevo.com.
2. Add a **sender** (e.g. your Gmail address) and confirm it from the verification email Brevo sends.
3. Create an **API key** (SMTP & API → API Keys → Generate) and copy it.
4. In Railway → your **backend service** → Variables, add:
   - `EMAIL_PROVIDER` = `brevo`
   - `EMAIL_API_KEY`  = the key you copied
   - `EMAIL_FROM`     = the sender address you verified in step 2
   - `EMAIL_FROM_NAME` = `AuraOS` (optional)
5. Let Railway redeploy.

(Resend also works: `EMAIL_PROVIDER=resend`, with a sender on a domain you verified in Resend.)

## 3. Use it
Menu page → **Send OTP** → check the email → enter the code. To change the email: unlock the menu, then
**Change / turn off** (top right) → enter the new email → Save. Leave it empty and Save to turn the lock off.

If email is not set up (or fails), the code is printed in the backend's Railway logs, so the owner is never locked out.
