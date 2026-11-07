# WiFi / LAN printing with the AuraOS Android app

Browsers can't talk to WiFi/LAN printers, so AuraOS ships an Android app: a thin
wrapper that opens your hosted (Railway) site, plus a native plugin that sends
KOTs and bills to the printer's IP on port 9100. Your site keeps updating
normally — the APK only needs rebuilding if you change the app URL.

## 1. Build the APK (once)
1. Push these files to GitHub.
2. Repo → **Settings → Secrets and variables → Actions → Variables → New variable**
   `APP_URL` = your Railway frontend address (e.g. `https://your-app.up.railway.app`).
3. **Actions** tab → **Build Android APK** → **Run workflow**.
4. When it finishes (~10 min), open the run and download the **AuraOS-apk** artifact (a zip containing `AuraOS.apk`).

## 2. Install on the Android device
Copy `AuraOS.apk` to the phone/tablet, open it, allow "Install unknown apps" if asked, install, open **AuraOS**, and log in as usual.

## 3. Connect the printer
1. Printer on, joined to the restaurant WiFi (or plugged into the router by Ethernet).
2. Find its IP (hold the Feed button while powering on to print a self-test slip) and reserve that IP in the router so it never changes.
3. Phone/tablet must be on the **same WiFi**.
4. In the app: **Printer Settings** → *WiFi / LAN printer* → enter IP and port `9100` → **Connect** → **Test print**.
   (Kitchen screen: **Connect Printer → Connect via WiFi / LAN**.)

The IP is remembered on that device; KOT auto-print on the Kitchen screen then works as before.
Repeat step 3 on every device that should print.

## Troubleshooting
- "Can't reach IP:9100": wrong IP, printer off, different WiFi, or WiFi "client isolation" is on in the router.
- Prints garbage: printer isn't ESC/POS — tell me the model.
- Connected but nothing prints: try the self-test slip to confirm the printer works, then check the paper size setting.
