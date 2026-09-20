# Restaurant Management System (RMS)

An operational restaurant system: waiter POS for tablets, kitchen and bar displays,
automatic routing of order items to stations, live status updates, receipts, menu /
table / staff management, management dashboard and reports, and an audit log.

**The interface is Persian and right-to-left (RTL):** Vazirmatn font bundled with the app
(no internet needed), Persian digits, amounts in Toman, Jalali (solar hijri) dates and a
Jalali date picker. Server messages, audit-log entries, CSV exports and the receipt are
Persian as well.

Recording payments at the cashier (cash, card terminal, split bills) is included; taxes/VAT,
payment gateways, card-terminal integration and formal accounting are **out of scope** by design.

- Architecture, database schema, API and user flows: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Narrated training videos (Persian), one per role: [latest release](../../releases/latest)

---

## Quick start

Requirements: **Node.js 22.13 or newer** (uses the built-in `node:sqlite`; no database server to install).

```bash
npm run setup
```

`setup` installs server and client dependencies, creates `server/data/rms.sqlite`, and loads
Persian demo data: «رستوران زیتون», 10 tables (میز ۱ … میز ۱۰), 8 categories, 33 menu items
priced in Toman, 5 users, and 30 days of order history so reports have something to show.

```bash
npm run dev
```

Open **http://localhost:5173**. The API runs on http://localhost:4000 and Vite proxies
`/api`, `/socket.io` and `/uploads` to it. Other devices on the same Wi-Fi (tablets in the
kitchen, phones) can use `http://<this-computer's-LAN-IP>:5173`.

### Demo accounts

| Role | Username | Password | Lands on |
|---|---|---|---|
| Manager | `manager` | `manager123` | Dashboard (full access) |
| Waiter | `ali` | `waiter123` | Floor |
| Waiter | `maryam` | `waiter123` | Floor |
| Kitchen | `sara` | `kitchen123` | Kitchen display |
| Bar | `omid` | `bar12345` | Bar display |
| Cashier | `neda` | `cashier123` | Cashier / register (صندوق) |

Sessions are cookies, so one browser = one signed-in user. To try several roles on one
computer use separate browser profiles / a private window, or open the app under different
host names (e.g. `localhost:5173` and `127.0.0.1:5173` keep separate cookies).

---

## Running in production (single process)

```bash
npm run build                     # builds client/dist
cd server
set JWT_SECRET=<long random string>        # PowerShell: $env:JWT_SECRET="..."; bash: export JWT_SECRET=...
set NODE_ENV=production
npm start                         # serves API + WebSocket + the built app on PORT (default 4000)
```

For a **new restaurant without demo data**:

```bash
cd server
MANAGER_PASSWORD='choose-a-strong-one' RESTAURANT_NAME='My Restaurant' npm run init
```

This creates the roles, the Kitchen/Bar/Other stations and one manager account; everything
else (menu, tables, staff) is done in the UI.

### Environment variables (server)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `4000` / `0.0.0.0` | Listen address |
| `JWT_SECRET` | generated in dev | **Required in production.** Signs session tokens |
| `NODE_ENV` | — | `production` enables secure cookies & HSTS |
| `COOKIE_SECURE` | `true` in production | Set `false` for a LAN-only install served over plain HTTP |
| `SESSION_HOURS` | `12` | Session length (one shift) |
| `DB_FILE` | `server/data/rms.sqlite` | SQLite database path — back this file up |
| `UPLOAD_DIR` | `server/uploads` | Menu images |
| `TRUST_PROXY` | — | Set (e.g. `1`) when behind nginx so client IPs are correct |
| `LOGIN_MAX_ATTEMPTS` | `10` | Failed logins per username+IP per 15 minutes |
| `SEED_TIMEZONE` | `Asia/Tehran` | Timezone for seeded restaurant |

When serving behind nginx, proxy WebSocket upgrades for `/socket.io/`.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run setup` | Install everything and reset the database with demo data |
| `npm run dev` | API (auto-restart) + Vite dev server |
| `npm run build` | Production build of the client |
| `npm start` | Start the server (serves `client/dist` when built) |
| `npm test` | Server test suite (see below) |
| `npm run db:reset` | Wipe the database and reload demo data + history |
| `npm run db:migrate` | Apply pending SQL migrations |

---

## What is implemented

| Area | Where |
|---|---|
| Authentication (scrypt hashes, httpOnly JWT cookie, login throttling, instant revocation) | `server/src/auth`, `server/src/http/auth.js` |
| Role-based access (Manager, Waiter, Kitchen, Bar, Cashier) enforced in routes **and** services | `server/src/auth/permissions.js` |
| Floor plan with derived table status (Available, Waiting for order, Ordering, Preparing, Ready, Occupied, Completed) | `client/src/pages/Floor.jsx` |
| Waiter POS: guests, menu search & categories, quantities, notes, multi-round orders, deliver, receipt, complete, cancel | `client/src/pages/OrderScreen.jsx` |
| Three ordering workflows the manager switches on: at the table (waiter), ordered **and paid** at the counter then served at a table, and ordered and paid at the counter for takeaway | `client/src/components/CounterOrder.jsx`, `server/src/services/counter.js` |
| Automatic Kitchen / Bar split — one order, per-station tickets | `server/src/services/orders.js` (`submitBatch`), `stationTickets.js` |
| Kitchen & Bar displays: New / Preparing / Ready lanes, big START / READY buttons, per-item taps, undo, timers with warn/late colours, new-ticket chime | `client/src/pages/StationDisplay.jsx` |
| Independent item statuses + derived order status | `server/src/services/statusRules.js` |
| Real-time updates (Socket.IO, per-station rooms, reconnect resync) and waiter "ready" bell with sound | `server/src/realtime`, `client/src/components/ReadyBell.jsx` |
| Receipt: preview, print (80 mm), save as PDF via the print dialog, print count, payments and change | `client/src/components/ReceiptPreview.jsx` |
| Cashier (صندوق): bills waiting for payment, cash with change, card terminal, other; split between guests; void with reason; pay-and-complete; today's takings by method | `client/src/pages/Cashier.jsx`, `server/src/services/payments.js` |
| Menu & categories: CRUD, price, station, type (food / drink / non-food), active, in stock, images | `client/src/pages/manager/MenuAdmin.jsx` |
| Tables: add, rename, capacity, area, delete/archive | `client/src/pages/manager/TablesAdmin.jsx` |
| Staff: create, edit, role, reset password, activate/deactivate | `client/src/pages/manager/Staff.jsx` |
| Stations & restaurant settings (currency, timezone, business-day start, week start, KDS thresholds) | `client/src/pages/manager/Settings.jsx` |
| Dashboard: today's sales, orders, active tables, AOV, top items, categories, waiters, kitchen & bar performance | `client/src/pages/manager/Dashboard.jsx` |
| Reports: today / yesterday / week / month / custom, daily & hourly sales, best & least sellers, categories, waiters, station prep times, CSV export | `client/src/pages/manager/Reports.jsx` |
| Order search by number, table, waiter, date, status | `client/src/pages/Orders.jsx` |
| Audit log with filters | `client/src/pages/manager/AuditLog.jsx` |

### Behaviour worth knowing

**Ordering workflows.** Settings → «روش‌های سفارش‌گیری» turns each of the three on or off
(at least one must stay on, and table service can only be switched off once no table order is
still open):

- **سر میز** — the guest sits, the waiter takes the order, the bill is paid at the end.
- **پیشخوان، سرو سر میز** — the guest orders and pays at the cashier, then sits down; the
  cashier can pick a free table right away or leave it empty, in which case the order shows on
  the floor under "counter orders without a table" until a waiter attaches one. The waiter then
  delivers and completes it as usual — it is already paid.
- **پیشخوان، تحویل بیرون‌بر** — the guest orders, pays and waits at the counter. No table and no
  waiter: when the stations finish, the order turns green in the cashier's counter queue and
  **تحویل مشتری** hands it over and closes it in one step.

A counter order is written in a single transaction — order, items and payment together — so the
kitchen never receives an unpaid counter order and a double tap cannot order twice. The payment
must cover the whole order; anything the guest adds later is billed the normal way.

- **Order numbers** are sequential per restaurant (#1001, #1002 …) and searchable.
- **Adding more food later** appends a new *round* to the same order; the kitchen sees it
  as a separate ticket marked *Round 2*.
- **Prices are snapshotted** when items are sent, so later price changes never alter
  existing orders, receipts or past reports.
- **"Other (no preparation)"** station: items such as bottled water are ready the moment
  they are ordered, so the waiter just delivers them. Any station can be switched to this mode.
- **Sales** in reports = completed orders, grouped by *business day* (orders after
  midnight belong to the previous day until the configured day-start hour).
- **Calendar:** all dates are shown in the Jalali calendar. The "این ماه" (this month) report
  preset starts on the 1st of the current Jalali month; the week starts on Saturday by default
  (changeable in Settings). The API itself exchanges Gregorian `YYYY-MM-DD` dates.
- **Currency:** the demo restaurant uses Toman with 0 decimals (`IRT` in CSV headers). Symbol,
  code and decimals are settings; decimals can only change before the first order.
- **Digits:** search boxes accept Persian or Latin digits (e.g. «۱۸۹۹» or `1899`).
- **Payment (cashier):** guests usually pay after being served. The cashier records what was
  taken — cash (with change), card terminal, or other — possibly in several parts. A payment
  can never exceed what is still due; a double tap is recorded once; payments are never
  deleted, only voided with a reason. Adding items after payment reopens the bill; cancelling
  an item after payment shows an *over-payment* to correct. An order with payments cannot be
  cancelled until they are voided.
- **Complete only after payment:** setting «تکمیل سفارش فقط پس از تسویه» (on in the demo). When
  off, a waiter may complete an unpaid order and the bill stays in the cashier's due list.
- This records payments at the register; card terminals and gateways are **not** connected,
  and there is no tax or accounting.
- **Concurrency**: two waiters cannot open the same table twice; stale taps
  (another tablet already moved the item) return a conflict and the screen refreshes
  instead of overwriting; retried submits are de-duplicated.
- Items can be edited by waiters only while **Pending**; once the kitchen starts, only a
  manager can cancel.
- An order can be completed once every item is **Delivered** or **Cancelled**; the table
  then shows *Completed* until someone releases it after clearing.

---

## Training videos

Six narrated walkthroughs in Persian — a simple road map of one order end to end, plus one
detailed video per role — are attached to the [latest release](../../releases/latest):

| Video | Length |
|---|---|
| ۱ — نقشه راه: مسیر یک سفارش | 3:13 |
| ۲ — گارسون (waiter) | 5:15 |
| ۳ — آشپزخانه (kitchen) | 4:02 |
| ۴ — بار (bar) | 2:16 |
| ۵ — صندوقدار (cashier) | 4:29 |
| ۶ — مدیر (manager) | 4:31 |

They are recorded from the real app, not mocked: `video/capture.mjs` starts its own server on a
throwaway database, drives every role in its own browser session, and saves lossless frames;
`video/assemble.mjs` fits each scene to its own voice clip, so a slower or faster narrator never
drifts out of sync. The narration scripts live in `video/narration/`. See [video/README.md](video/README.md).

## Tests

```bash
npm test
```

Runs against a real HTTP server, real Socket.IO connections and a temporary SQLite file:

- the specification scenario end-to-end — waiter opens Table 5, orders Pizza ×2, Burger ×1,
  Coke ×2, Cappuccino ×1; kitchen sees only Pizza + Burger, bar only Coke + Cappuccino;
  kitchen and bar move items PENDING → PREPARING → READY; the waiter's socket receives the
  *ready* events; delivery; a second round (Coffee ×2, Cake ×1) on the same order; every item
  DELIVERED; receipt lines and total; completion; release; search, report and audit entries;
- role permissions (waiter blocked from reports/menu/settings, kitchen blocked from bar data
  and from orders even when guessing IDs, cross-origin requests rejected);
- concurrency (simultaneous edits, duplicate table opening, idempotent submit, stale transitions);
- unavailable items, auto-ready items, price-change snapshots, session revocation on deactivation;
- report presets, custom ranges, CSV export; pure status-rule unit tests.

---

## Project layout

```
restaurant-rms/
├─ docs/ARCHITECTURE.md       architecture, schema, API, flows
├─ scripts/dev.mjs            runs API + client together
├─ server/
│  ├─ src/
│  │  ├─ auth/                passwords, sessions, permission matrix
│  │  ├─ db/                  connection, migrations/*.sql, seed
│  │  ├─ http/                auth middleware, errors, validation helpers
│  │  ├─ realtime/            Socket.IO server + notification hub
│  │  ├─ routes/              thin HTTP layer (zod-validated)
│  │  └─ services/            business rules (orders, tables, menu, reports…)
│  └─ test/                   node:test suites
└─ client/
   └─ src/
      ├─ lib/                 api client, auth, realtime, hooks, formatting
      ├─ components/          layout, bell, order items, receipt, charts, UI kit
      └─ pages/               floor, order screen, orders, station display, manager/*
```

## Not included (by scope)

Payments and gateways, tax/VAT, formal accounting, multi-branch, inventory, loyalty, online
ordering and kitchen printers are not implemented. The schema and service boundaries are
prepared for them — see *Extension points* in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
