# Architecture

This document was written before implementation and is kept in sync with the code.
It covers: system architecture, database schema, API design, real-time design,
user flows, concurrency rules, and extension points.

---

## 1. System overview

```
┌───────────────────────────── Browser (tablet / desktop / phone) ─────────────────────────────┐
│  React SPA (Vite)                                                                            │
│   ├─ Waiter POS      /floor, /tables/:id, /orders                                            │
│   ├─ Station display /station/:id   (Kitchen, Bar, …)                                        │
│   └─ Manager         /dashboard, /menu, /tables-admin, /staff, /reports, /audit, /settings   │
│  REST (fetch, httpOnly cookie)          Socket.IO (same cookie)                              │
└──────────────┬──────────────────────────────────────────────┬────────────────────────────────┘
               │ /api/*                                        │ /socket.io
┌──────────────▼──────────────────────────────────────────────▼────────────────────────────────┐
│  Node.js 22 · Express 5                                                                      │
│   middleware: helmet · cookie auth (JWT) · RBAC · zod validation · error handler             │
│   routes/     thin HTTP layer: parse → authorize → call service → respond                    │
│   services/   business rules (order lifecycle, routing to stations, status derivation,        │
│               reports, audit) — the only place that writes to the DB                         │
│   realtime/   Socket.IO rooms per restaurant / floor / station / user                        │
│  SQLite (node:sqlite, WAL) — schema managed by numbered SQL migrations                       │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Why this stack**

* **SQLite via built-in `node:sqlite`**: zero native build, one file, transactional, and a
  single restaurant's load (a few hundred orders/day) is far below its limits. All SQL is
  standard; moving to PostgreSQL later only means swapping `db/connection.js` and the
  `?`-placeholders.
* **Express + Socket.IO**: boring, well-understood, one process serves API, websockets and
  the built SPA on one port — easy to deploy on a single restaurant PC or a small VPS.
* **React SPA without a UI kit**: the POS and kitchen screens need big, custom touch
  controls; a component library would mostly get in the way.

**Real-time strategy — "notify, then refetch".** Socket events carry only identifiers
(`orders:changed {orderId}`, `station:changed {stationId}`). Clients refetch through the
REST API, which applies the same RBAC as every other request. Consequences:

* a Bar user never receives Kitchen item data over the socket, even by accident;
* a client that missed events (Wi-Fi drop) resyncs on reconnect with a full refetch;
* there is exactly one code path that shapes data for each screen.

---

## 2. Roles and permissions

Roles are rows in `roles`; the permission matrix lives in code
(`server/src/auth/permissions.js`) because permissions change with code, not with data.

| Permission                        | Manager | Waiter | Kitchen | Bar | Cashier |
|----------------------------------|:-------:|:------:|:-------:|:---:|:-------:|
| View floor / tables              | ✔ | ✔ |   |   |   |
| Open order, add items, deliver   | ✔ | ✔ |   |   |   |
| Take a counter order (order + payment in one step) | ✔ |   |   |   | ✔ |
| Attach a table to a counter order | ✔ | ✔ |   |   | ✔ |
| Hand a pickup order to the guest | ✔ | ✔ |   |   | ✔ |
| Cancel a PENDING item            | ✔ | ✔ |   |   |   |
| Cancel a PREPARING/READY item    | ✔ |   |   |   |   |
| Complete order                   | ✔ | ✔ |   |   | ✔ (pay-and-complete) |
| Print receipt                    | ✔ | ✔ |   |   | ✔ |
| Search / view orders             | ✔ | ✔ |   |   | ✔ |
| Take payments, void payments     | ✔ |   |   |   | ✔ |
| Station display (own station)    | ✔ (all) |   | ✔ (stations assigned to Kitchen role) | ✔ (stations assigned to Bar role) |   |
| Advance item status at station   | ✔ |   | ✔ | ✔ |   |
| Menu / categories / tables admin | ✔ |   |   |   |   |
| Staff, stations, settings        | ✔ |   |   |   |   |
| Dashboard, reports, audit log    | ✔ |   |   |   |   |

Station access is **data-driven**: each station row has `role_id`. Kitchen staff see every
active station whose role is `KITCHEN` (so adding a "Grill" station later needs no code).

Every query is additionally scoped by `restaurant_id` taken from the authenticated user —
never from the request — so changing an ID in a URL cannot reach another restaurant's data,
and a station user asking for `/api/orders/:id` gets `403`.

---

## 3. Database schema

All money is stored as **integer minor units** (e.g. cents) to avoid floating-point errors.
All timestamps are UTC ISO-8601 strings. `business_date` is the local restaurant date
(respecting `timezone` and `day_start_hour`, so a 01:30 order counts for the previous
business day when the day starts at 04:00).

```
restaurants ─┬─< users >── roles
             ├─< stations >── roles (who works the station)
             ├─< dining_tables
             ├─< menu_categories ─< menu_items >── stations
             ├─< orders >── dining_tables, users(waiter)
             │     └─< order_batches (each "Submit" = one batch / round)
             │           └─< order_items >── menu_items, stations
             │                 └─< order_item_status_history >── users
             └─< audit_logs >── users
```

### restaurants
| column | type | notes |
|---|---|---|
| id | INTEGER PK | |
| name, address, phone | TEXT | shown on receipt |
| receipt_footer | TEXT | e.g. "Thank you" |
| currency_symbol / currency_code | TEXT | display only |
| currency_decimals | INTEGER | minor-unit scale (2 → cents, 0 → rial/toman) |
| timezone | TEXT | IANA, e.g. `Asia/Tehran` |
| day_start_hour | INTEGER 0–23 | business-day cut-off |
| week_start_day | INTEGER 0–6 | 0 = Sunday, 1 = Monday, 6 = Saturday |
| kds_warn_minutes / kds_late_minutes | INTEGER | ticket colour thresholds |
| order_seq | INTEGER | last issued order number (atomic counter) |

The three ordering workflows are switched on per restaurant by
`mode_table_service`, `mode_counter_table`, `mode_counter_pickup` (at least one must stay on;
table service can only be switched off when no table order is still open).

### roles
`id, code UNIQUE (MANAGER|WAITER|KITCHEN|BAR), name, description`

### users
`id, restaurant_id FK, role_id FK, name, username UNIQUE (case-insensitive), password_hash
(scrypt), is_active, token_version, last_login_at, created_at, updated_at`

`token_version` is embedded in the JWT; incrementing it (password change, deactivation,
role change) invalidates every existing session immediately.

### stations
`id, restaurant_id FK, code, name, role_id FK NULL, auto_ready, sort_order, is_active`
— `UNIQUE(restaurant_id, code)`. `auto_ready = 1` means items routed here need no
preparation (bottled water, non-food items): they are created `READY` so the waiter just
delivers them.

### dining_tables
`id, restaurant_id FK, name, capacity, area, sort_order, is_active, created_at, updated_at`
A table with order history is soft-deleted (`is_active = 0`) so old orders keep their table.

### menu_categories
`id, restaurant_id FK, name, sort_order, is_active, created_at, updated_at`
— `UNIQUE(restaurant_id, name)`.

### menu_items
`id, restaurant_id FK, category_id FK, station_id FK, name, description, price INTEGER,
item_type (FOOD|DRINK|NON_FOOD), image_path, is_active, is_available, sort_order,
deleted_at, created_at, updated_at`
`is_active` = shown on the menu at all; `is_available` = in stock right now (shown greyed
out). Deleting an item that was ever ordered is a soft delete.

### orders
| column | notes |
|---|---|
| id, restaurant_id | |
| order_number | `UNIQUE(restaurant_id, order_number)`; allocated from `restaurants.order_seq` inside the creating transaction → #1001, #1002, … |
| table_id FK | **nullable**: a pickup order has no table, and a counter order may get one later. The partial unique index still guarantees one live order per table, and SQLite treats NULLs as distinct, so any number of pickup orders can be open |
| waiter_id FK | who opened the order — the waiter, or the cashier for a counter order |
| guest_count, note | |
| lifecycle | `ACTIVE`, `COMPLETED`, `CANCELLED` — set by explicit user actions |
| status | derived and stored (for filtering): `OPEN, IN_PROGRESS, PARTIALLY_READY, READY, DELIVERED, COMPLETED, CANCELLED` |
| business_date | local date for reporting |
| opened_at, completed_at, cancelled_at, cancel_reason | |
| service_mode | `TABLE` (waiter takes it at the table), `COUNTER_TABLE` (ordered and paid at the counter, eaten at a table), `COUNTER_PICKUP` (ordered and paid at the counter, taken away) |
| customer_name | optional, for calling a counter guest |
| client_request_id | set for counter orders; `UNIQUE(restaurant_id, client_request_id)` makes "take the money and send it" safe to retry |
| released_at | table freed. **Partial unique index `UNIQUE(table_id) WHERE released_at IS NULL`** guarantees one live order per table even if two waiters tap the same table at the same moment |
| ordering_user_id, ordering_until | "someone is composing an order on this table" presence, expires by time |
| subtotal | cached sum of non-cancelled items, recomputed in the same transaction as any item change |
| receipt_print_count | |
| version | optimistic-concurrency counter |

### order_batches
`id, order_id FK, batch_no, created_by FK, client_request_id, submitted_at`
`UNIQUE(order_id, batch_no)`, `UNIQUE(order_id, client_request_id)` — the client sends a
random id per Submit, so a double-tap or a retry after a network timeout never creates
duplicate items. A station ticket is *(order, batch, station)*, so a follow-up round
("Coffee × 2, Cake × 1") appears as a new ticket marked **Round 2**.

### order_items
`id, order_id FK, batch_id FK, menu_item_id FK, station_id FK, category_id FK,
item_name, unit_price, quantity, note, status (PENDING|PREPARING|READY|DELIVERED|CANCELLED),
version, created_by, submitted_at, started_at, ready_at, delivered_at, cancelled_at,
cancelled_by, cancel_reason, updated_at`

Name, price, category and station are **snapshots** taken at submit time: changing a price
later never changes an existing order or a past report.

### order_item_status_history
`id, order_item_id FK, from_status, to_status, changed_by FK, changed_at`
Source of truth for preparation-time analytics and for the order timeline.

### payments (migration 002)
`id, restaurant_id, order_id FK, method (CASH|CARD|OTHER), amount, received_amount (cash
handed over; change = received − amount), reference (card tracking no.), client_request_id,
business_date (day the money was taken), created_by, created_at, voided_at, voided_by,
void_reason` — `UNIQUE(order_id, client_request_id)`.

Several rows per order = split bill / mixed methods. Rows are never deleted, only voided.
`orders.paid_amount` (sum of valid payments) and `orders.payment_status`
(`UNPAID | PARTIAL | PAID | OVERPAID`) are recomputed together with the subtotal in the same
transaction as any item or payment change, so adding an item after payment reopens the bill
and cancelling one after payment shows an over-payment. `restaurants.require_payment_to_complete`
blocks completing an order until it is exactly paid.

Rules enforced by the service: a payment may not exceed what is still due (cash handed over
may, producing change); a cancelled order takes no payments; an order with valid payments
cannot be cancelled until they are voided.

### audit_logs
`id, restaurant_id, user_id FK NULL, action, entity_type, entity_id, summary, metadata (JSON),
ip, created_at` — indexed by `(restaurant_id, created_at)`.

---

## 4. Status rules

### Item state machine

```
PENDING ──start──▶ PREPARING ──ready──▶ READY ──deliver──▶ DELIVERED
   ▲                  │  ▲                │
   └────── undo ──────┘  └───── undo ─────┘
PENDING / PREPARING / READY ──cancel──▶ CANCELLED
```

| transition | who |
|---|---|
| PENDING→PREPARING, PREPARING→READY, and the two undos | station staff of the item's station, manager |
| READY→DELIVERED | waiter, station staff (counter pickup), manager |
| PENDING→CANCELLED | waiter, manager |
| PREPARING/READY→CANCELLED | manager |
| quantity/note edit | waiter/manager, only while PENDING |

Every transition is a single conditional update:
`UPDATE order_items SET status=:to, version=version+1 WHERE id=:id AND status=:from`.
If zero rows change, somebody else changed the item first → `409 Conflict` with the
current state; the client refreshes. Nothing is ever silently overwritten.

### Order status (derived from active = non-cancelled items)

1. lifecycle `COMPLETED` / `CANCELLED` → that value
2. no active items → `OPEN`
3. all active items `DELIVERED` → `DELIVERED`
4. all active items `PENDING` → `OPEN` (submitted, nobody started yet)
5. all active items `READY` or `DELIVERED` → `READY`
6. any `READY` → `PARTIALLY_READY`
7. otherwise → `IN_PROGRESS`

Example from the spec: Pizza READY, Burger PREPARING, Coke READY → rule 6 → `PARTIALLY_READY`.

An order can be **completed** only when no item is PENDING/PREPARING/READY.

### Table status (derived from the table's live order)

| status | condition |
|---|---|
| AVAILABLE | no unreleased order |
| COMPLETED | order completed, table not yet released (needs clearing) |
| ORDERING | live order and `ordering_until > now` (a waiter has items in the cart) |
| READY | some item READY (food waiting at the pass) |
| PREPARING | some item PENDING or PREPARING |
| WAITING_FOR_ORDER | live order with no items yet (guests seated) |
| OCCUPIED | live order, everything delivered (guests dining) |

---

## 5. REST API

Base path `/api`. JSON in/out. Auth by httpOnly `SameSite=Strict` cookie. Errors:
`{ "error": { "code": "CONFLICT", "message": "…", "details": … } }`.

### Auth
| method | path | role | body / notes |
|---|---|---|---|
| POST | /auth/login | public | `{username, password}` — rate-limited |
| POST | /auth/logout | any | |
| GET | /auth/me | any | current user + role + accessible stations |
| POST | /auth/change-password | any | `{currentPassword, newPassword}` |

### Restaurant & settings
| GET | /restaurant | any | name, currency, KDS thresholds |
|---|---|---|---|
| PUT | /restaurant | manager | settings |

### Staff & roles
| GET | /roles | manager |
|---|---|---|
| GET | /users | manager — `?q=&role=&active=` |
| POST | /users | manager |
| PUT | /users/:id | manager — name, username, role, active, optional new password |

### Stations
| GET | /stations | any authenticated |
|---|---|---|
| POST | /stations | manager |
| PUT | /stations/:id | manager |
| GET | /stations/:id/tickets | station staff of that station, manager — `?include=ready` |
| POST | /stations/:id/tickets/:batchId/advance | station staff, manager — `{from, to}` bulk transition for that ticket's items |

### Tables
| GET | /tables | manager, waiter — with live status, order summary, ready count |
|---|---|---|
| POST | /tables | manager |
| PUT | /tables/:id | manager |
| DELETE | /tables/:id | manager (soft if it has history, refused while occupied) |
| POST | /tables/:id/release | manager, waiter — frees a COMPLETED table |

### Menu
| GET | /menu/categories | any |
|---|---|---|
| POST | /menu/categories | manager |
| PUT | /menu/categories/:id | manager |
| DELETE | /menu/categories/:id | manager (refused if it still has items) |
| GET | /menu/items | manager, waiter — waiters get active items only |
| POST | /menu/items | manager |
| PUT | /menu/items/:id | manager |
| PATCH | /menu/items/:id/availability | manager — `{isAvailable}` |
| DELETE | /menu/items/:id | manager |
| POST | /menu/items/:id/image | manager — multipart `image` (jpg/png/webp ≤ 2 MB) |
| DELETE | /menu/items/:id/image | manager |

### Orders
| GET | /orders | manager, waiter — `?q=(order number)&tableId=&waiterId=&status=&from=&to=&page=` |
|---|---|---|
| GET | /orders/ready | manager, waiter — ready-to-serve items grouped by table (notification bell) |
| GET | /orders/:id | manager, waiter — full order with batches, items, statuses |
| POST | /orders | manager, waiter — `{tableId, guestCount}` opens the table; `409` + existing order if already open |
| PATCH | /orders/:id | manager, waiter — `{guestCount?, note?, version}` |
| POST | /orders/:id/ordering | manager, waiter — `{active}` presence heartbeat |
| POST | /orders/:id/batches | manager, waiter — `{clientRequestId, items:[{menuItemId, quantity, note}]}` |
| POST | /orders/:id/deliver-ready | manager, waiter — mark every READY item delivered |
| POST | /orders/:id/complete | manager, waiter |
| POST | /orders/:id/cancel | manager; waiter only if nothing has started — `{reason}` |
| GET | /orders/:id/receipt | manager, waiter |
| POST | /orders/:id/receipt/printed | manager, waiter — counts prints, audit log |
| PATCH | /order-items/:id | manager, waiter — `{quantity?, note?, version}` while PENDING |
| POST | /order-items/:id/status | role-dependent (see state machine) — `{from, to, reason?}` |

### Cashier (manager, cashier)
| GET | /cashier/orders | `?view=due|paid&q=` — bills waiting for payment (unpaid, partial, over-paid) or settled today |
|---|---|---|
| GET | /cashier/summary | today's takings by method, change given, voids, what is still due |
| POST | /orders/:id/payments | `{clientRequestId, method, amount, receivedAmount?, reference?, completeOrder?}` |
| POST | /payments/:id/void | `{reason}` |
| POST | /counter-orders | `{clientRequestId, mode, tableId?, customerName?, items[], payment{method, amount, receivedAmount?, reference?}}` — creates the order, its items and the payment in **one transaction**; `payment.amount` must equal the order total |
| GET | /counter/queue | counter orders still cooking, waiting to be handed over, or still without a table |
| POST | /orders/:id/table | `{tableId}` (or `null`) — attach a table to a counter order after the guest sits down |
| POST | /orders/:id/hand-over | give a pickup order to the guest; delivers everything ready and closes the order |

`GET /orders/:id` also returns `paidAmount, remaining, paymentStatus, payments[],
completeBlockedReason`; `GET /orders` accepts `paymentStatus`; the receipt includes payments.

### Reports (manager)
| GET | /reports/dashboard | today's KPIs + live floor numbers |
|---|---|---|
| GET | /reports/summary | `?range=today|yesterday|week|month|custom&from=&to=` — sales, orders, AOV, daily series, items (top & bottom), categories, waiters, station performance |
| GET | /reports/export | same range + `type=daily|items|categories|waiters|stations|orders` → CSV |

### Audit
| GET | /audit-logs | manager — `?userId=&action=&entityType=&q=&from=&to=&page=` |
|---|---|---|

---

## 6. Real-time events (Socket.IO)

The socket authenticates with the same cookie. Rooms:

| room | members |
|---|---|
| `r:{rid}` | everyone in the restaurant |
| `r:{rid}:floor` | managers, waiters |
| `r:{rid}:station:{sid}` | staff allowed at that station, managers |
| `u:{uid}` | that user's sockets |

| event | room | payload |
|---|---|---|
| `orders:changed` | floor | `{orderId, tableId}` |
| `station:changed` | station | `{stationId}` |
| `items:ready` | floor | `{orderId, orderNumber, tableId, tableName, waiterId, count, items[]}` → bell + sound |
| `tables:changed` | floor | `{}` |
| `menu:changed` | restaurant | `{}` |
| `settings:changed` | restaurant | `{}` |
| `session:revoked` | user | `{}` → client logs out |

---

## 7. User flows

**Waiter — new table**
Floor → tap *Table 5* (Available) → enter guests (2 taps) → order screen opens with the
menu on the left and the ticket on the right → tap items (search / category chips), `+`/`−`,
optional note per line → **Send to kitchen & bar** → items appear under *Round 1* with live
status chips. The table tile turns *Preparing*.

**Station — preparing**
Station display shows three lanes: *New · Preparing · Ready for pickup*. Each card is one
ticket (table, order #, round, waiter, elapsed timer, items with notes). **START** moves the
ticket's items to PREPARING; **READY** moves them to READY; tapping a single item advances
just that item (Pizza ready while Burger still cooks). Colour changes at the warn/late
thresholds.

**Waiter — serving**
When an item turns READY the waiter's screen plays a chime and the bell shows
*Table 5 · 2 items ready*. Tap → order → **Deliver** per item or **Deliver all ready**.

**Counter — guest orders and pays first**
Cashier → *New counter order* → pick items → choose *At a table* or *Takeaway* → for a table
order pick a free table (or leave it empty) → optional guest name → take cash (change is shown)
or card → **Take payment and send**. Order, items and payment are written in one transaction,
so the kitchen never sees an unpaid counter order and a retry cannot order twice. The ticket
reaches the stations exactly like a waiter's order, labelled *بیرون‌بر* / the table name.

**Counter — takeaway handover**
The guest waits with the order number. When the stations mark it READY it turns green in the
cashier's *counter queue*; **Hand to guest** delivers the items and — since it is already paid
and has no table to clear — closes the order in the same step.

**Counter — guest sits down**
A counter order with no table shows on the floor as *counter orders without a table*; any
waiter (or the cashier) attaches a table, after which it behaves like any seated order: the
waiter delivers it and completes it. It is already paid, so completion is never blocked.

**Waiter — second round**
Open the same table → add *Coffee × 2, Cake × 1* → Send → same order #, *Round 2* ticket.

**Cashier — payment after service**
Cashier screen lists served bills (updates live) → pick a bill → items, total, paid, remaining →
choose cash / card terminal / other, optionally split between N guests → for cash enter the
money handed over and read the change → «ثبت پرداخت». When the payment settles a fully served
bill, «پس از تسویه، سفارش تکمیل شود» closes the order in the same step. Mistakes are voided
with a reason and appear in the audit log and the payments CSV.

**Waiter — close**
Everything delivered → **Receipt** (print preview → Print / Save as PDF) → **Complete order**
→ table shows *Completed* → **Release table** when cleaned → *Available*.

**Manager**
Dashboard (today) → Reports (preset or custom range, CSV export) → Menu (items, prices,
availability, images, categories) → Tables → Staff → Stations → Settings → Audit log.

---

## 8. Security

* Passwords: `scrypt` (N=16384, r=8, p=1, 16-byte salt), constant-time compare.
* Session: signed JWT (HS256, 12 h) in an httpOnly, `SameSite=Strict` cookie; `Secure` in
  production. Each request reloads the user, so deactivation or a role change takes effect
  on the next request (and connected sockets are dropped).
* CSRF: `SameSite=Strict` cookie + mutations accept only `application/json` or multipart
  from same origin.
* Login throttling: 10 failed attempts per username+IP per 15 minutes.
* Validation: every body/query parsed by a zod schema; unknown fields rejected.
* RBAC checked in route middleware *and* resource ownership checked in services
  (restaurant scope, station ownership).
* Uploads: extension + MIME allow-list, 2 MB cap, random file names.
* `helmet` security headers, JSON body limit.

---

## 9. Extension points (not implemented)

| future feature | where it plugs in |
|---|---|
| Multiple restaurants / branches | every table already carries `restaurant_id`; add a `branches` table and a `branch_id` beside it, and a restaurant picker at login |
| Inventory | `menu_items` ↔ new `recipes`/`stock_items`; decrement in `orderService.submitBatch` |
| Loyalty | `customers` table + nullable `orders.customer_id` |
| Online ordering | a new "channel" column on `orders`; `order_batches` already model incoming rounds |
| Kitchen printers | subscribe to the existing `station:changed` flow or add a printer adapter per `stations` row |
