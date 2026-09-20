-- pragma: foreign_keys=off
-- Ordering workflows: besides the waiter taking the order at the table, the guest may order
-- and pay at the counter first — then either sit down (a waiter brings the food) or wait and
-- pick it up at the counter. The manager chooses which of the three are in use.

-- 1) Which workflows this restaurant offers. Existing installs keep table service only.
ALTER TABLE restaurants ADD COLUMN mode_table_service  INTEGER NOT NULL DEFAULT 1;
ALTER TABLE restaurants ADD COLUMN mode_counter_table  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE restaurants ADD COLUMN mode_counter_pickup INTEGER NOT NULL DEFAULT 0;

-- 2) Orders: a pickup order has no table, and a counter order may get its table later, so
--    table_id becomes nullable (SQLite cannot drop NOT NULL: rebuild the table).
--    client_request_id makes "take payment and send to the kitchen" safe to retry.
CREATE TABLE orders_new (
  id                   INTEGER PRIMARY KEY,
  restaurant_id        INTEGER NOT NULL REFERENCES restaurants(id),
  order_number         INTEGER NOT NULL,
  table_id             INTEGER REFERENCES dining_tables(id),
  waiter_id            INTEGER NOT NULL REFERENCES users(id),
  service_mode         TEXT    NOT NULL DEFAULT 'TABLE'
                        CHECK (service_mode IN ('TABLE','COUNTER_TABLE','COUNTER_PICKUP')),
  customer_name        TEXT    NOT NULL DEFAULT '',
  client_request_id    TEXT,
  guest_count          INTEGER NOT NULL DEFAULT 1 CHECK (guest_count BETWEEN 1 AND 100),
  note                 TEXT    NOT NULL DEFAULT '',
  lifecycle            TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle IN ('ACTIVE','COMPLETED','CANCELLED')),
  status               TEXT    NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN','IN_PROGRESS','PARTIALLY_READY','READY','DELIVERED','COMPLETED','CANCELLED')),
  subtotal             INTEGER NOT NULL DEFAULT 0,
  paid_amount          INTEGER NOT NULL DEFAULT 0,
  payment_status       TEXT    NOT NULL DEFAULT 'UNPAID',
  business_date        TEXT    NOT NULL,
  opened_at            TEXT    NOT NULL,
  completed_at         TEXT,
  completed_by         INTEGER REFERENCES users(id),
  cancelled_at         TEXT,
  cancelled_by         INTEGER REFERENCES users(id),
  cancel_reason        TEXT,
  released_at          TEXT,
  ordering_user_id     INTEGER REFERENCES users(id),
  ordering_until       TEXT,
  receipt_print_count  INTEGER NOT NULL DEFAULT 0,
  version              INTEGER NOT NULL DEFAULT 1,
  updated_at           TEXT    NOT NULL,
  UNIQUE (restaurant_id, order_number),
  -- a counter order without a table must not be "seated": guests are only on real tables
  CHECK (table_id IS NOT NULL OR service_mode <> 'TABLE')
);

INSERT INTO orders_new (
  id, restaurant_id, order_number, table_id, waiter_id, service_mode, customer_name, client_request_id,
  guest_count, note, lifecycle, status, subtotal, paid_amount, payment_status, business_date, opened_at,
  completed_at, completed_by, cancelled_at, cancelled_by, cancel_reason, released_at,
  ordering_user_id, ordering_until, receipt_print_count, version, updated_at)
SELECT
  id, restaurant_id, order_number, table_id, waiter_id, 'TABLE', '', NULL,
  guest_count, note, lifecycle, status, subtotal, paid_amount, payment_status, business_date, opened_at,
  completed_at, completed_by, cancelled_at, cancelled_by, cancel_reason, released_at,
  ordering_user_id, ordering_until, receipt_print_count, version, updated_at
FROM orders;

DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;

-- One live order per table as before; rows with no table are all distinct to SQLite,
-- so any number of pickup orders can be open at once.
CREATE UNIQUE INDEX ux_orders_live_table ON orders(table_id) WHERE released_at IS NULL;
CREATE UNIQUE INDEX ux_orders_client_request ON orders(restaurant_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX ix_orders_business_date ON orders(restaurant_id, business_date);
CREATE INDEX ix_orders_status ON orders(restaurant_id, status);
CREATE INDEX ix_orders_waiter ON orders(waiter_id);
CREATE INDEX ix_orders_service_mode ON orders(restaurant_id, service_mode);
