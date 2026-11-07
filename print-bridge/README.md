# AuraOS Print Bridge — setup (Windows PC)

A small program that stays running on a PC at the restaurant. Waiters and staff place orders from any phone or
browser; your server queues the print jobs; this program picks them up and prints them:

- **KOT printer** → kitchen tickets, printed automatically when an order is placed (or items are added)
- **BILL printer** → receipts, when someone presses *Print Bill* on a device that has "use the bridge" turned on

Each printer can be a **network printer** (Ethernet/WiFi, by IP) or a **USB printer** plugged into this PC.

## 1. Once, on the server (Railway)
Run the new database migration `migrations/047_print_bridge.sql`. Easiest: Railway → your **Postgres** service →
**Data** → **Query**, paste the file's contents, Run. (It is safe to run twice.)

## 2. Once, on the website
Log in as the owner/admin → **Printer** → **Restaurant print bridge** → turn it **On**. Copy the **bridge key**.

## 3. Once, on the Windows PC
1. Install **Node.js LTS** from nodejs.org (accept the defaults).
2. Copy this `print-bridge` folder to the PC, e.g. `C:\auraos-bridge`.
3. Copy `config.example.json` to `config.json` and edit it:
   - `server_url`: your Railway site address, e.g. `https://your-app.up.railway.app`
   - `bridge_key`: the key from step 2
   - `printers`: see below
4. Switch the PC's **sleep to "Never"** (Settings → System → Power) — the PC must stay on while the restaurant is open.

### Printers
**Network printer** (TVS RP 3230 and most others have an Ethernet port): plug it into the router, print its self-test slip
(hold **Feed** while switching on) to read the IP, and reserve that IP in the router.
```json
"KOT": { "type": "network", "host": "192.168.1.50", "port": 9100, "cols": 42, "cutter": true }
```
**USB printer on this PC**: install the printer's Windows driver, then run `node bridge.js --list` and copy its name exactly.
```json
"BILL": { "type": "windows", "name": "TVS RP 3230", "cols": 42, "cutter": true }
```
`cols`: 42 for 80 mm paper, 32 for 58 mm. You may swap which printer is KOT and which is BILL, or use the same type for both.

## 4. Test, then run
Open **Command Prompt** in the folder:
```
node bridge.js --test KOT
node bridge.js --test BILL
```
Each should print a small test slip. Then double-click **start-bridge.bat** — it keeps running and restarts itself if it stops.
On the website the card should now say **● Online**.

To start it automatically when the PC boots: press `Win + R`, type `shell:startup`, and put a shortcut to `start-bridge.bat` there.

## 5. On each device that prints receipts
Printer page → **Print receipts and KOT reprints from this device through the bridge** ✔.
(Kitchen tickets for new orders do not need this — the server sends them itself.)

## Troubleshooting
- **Card says Offline**: bridge not running, wrong `server_url`, or the PC is offline.
- **"Server refused the bridge key"**: copy the key again (or it was changed with *New key*), and check the bridge is **On**.
- **"Cannot reach 192.168.x.x:9100"**: printer off, different network, or its IP changed — reserve the IP in the router.
- **"Cannot open printer ..."** (USB): the name must match `node bridge.js --list` exactly.
- Failed jobs retry 3 times; the website's *Recent print jobs* list shows the reason.
- A KOT is sent once per order round. If it fails permanently, reprint it from the Kitchen screen.
