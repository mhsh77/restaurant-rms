-- Initial schema. See docs/ARCHITECTURE.md §3 for the rationale behind each table.

CREATE TABLE restaurants (
  id                 INTEGER PRIMARY KEY,
  name               TEXT    NOT NULL,
  address            TEXT    NOT NULL DEFAULT '',
  phone              TEXT    NOT NULL DEFAULT '',
  receipt_footer     TEXT    NOT NULL DEFAULT 'Thank you',
  currency_symbol    TEXT    NOT NULL DEFAULT '$',
  currency_code      TEXT    NOT NULL DEFAULT 'USD',
  currency_decimals  INTEGER NOT NULL DEFAULT 2 CHECK (currency_decimals BETWEEN 0 AND 3),
  timezone           TEXT    NOT NULL DEFAULT 'UTC',
  day_start_hour     INTEGER NOT NULL DEFAULT 4 CHECK (day_start_hour BETWEEN 0 AND 23),
  week_start_day     INTEGER NOT NULL DEFAULT 1 CHECK (week_start_day BETWEEN 0 AND 6),
  kds_warn_minutes   INTEGER NOT NULL DEFAULT 10,
  kds_late_minutes   INTEGER NOT NULL DEFAULT 20,
  order_seq          INTEGER NOT NULL DEFAULT 1000,
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL
);

CREATE TABLE roles (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE CHECK (code IN ('MANAGER','WAITER','KITCHEN','BAR')),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE users (
  id             INTEGER PRIMARY KEY,
  restaurant_id  INTEGER NOT NULL REFERENCES restaurants(id),
  role_id        INTEGER NOT NULL REFERENCES roles(id),
  name           TEXT    NOT NULL,
  username       TEXT    NOT NULL COLLATE NOCASE UNIQUE,
  password_hash  TEXT    NOT NULL,
  is_active      INTEGER NOT NULL DEFAULT 1,
  token_version  INTEGER NOT NULL DEFAULT 0,
  last_login_at  TEXT,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL
);
CREATE INDEX ix_users_restaurant ON users(restaurant_id);

CREATE TABLE stations (
  id             INTEGER PRIMARY KEY,
  restaurant_id  INTEGER NOT NULL REFERENCES restaurants(id),
  code           TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  role_id        INTEGER REFERENCES roles(id),
  auto_ready     INTEGER NOT NULL DEFAULT 0,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL,
  UNIQUE (restaurant_id, code)
);

CREATE TABLE dining_tables (
  id             INTEGER PRIMARY KEY,
  restaurant_id  INTEGER NOT NULL REFERENCES restaurants(id),
  name           TEXT    NOT NULL,
  capacity       INTEGER NOT NULL DEFAULT 4 CHECK (capacity BETWEEN 1 AND 100),
  area           TEXT    NOT NULL DEFAULT '',
  sort_order     INTEGER NOT NULL DEFAULT 0,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL
);
-- Names must be unique among live tables; a soft-deleted "Table 3" does not block a new one.
CREATE UNIQUE INDEX ux_tables_name_active ON dining_tables(restaurant_id, name COLLATE NOCASE) WHERE is_active = 1;

CREATE TABLE menu_categories (
  id             INTEGER PRIMARY KEY,
  restaurant_id  INTEGER NOT NULL REFERENCES restaurants(id),
  name           TEXT    NOT NULL COLLATE NOCASE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  is_active      INTEGER NOT NULL DEFAULT 1,
  deleted_at     TEXT,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL
);
CREATE UNIQUE INDEX ux_categories_name_live ON menu_categories(restaurant_id, name) WHERE deleted_at IS NULL;

CREATE TABLE menu_items (
  id             INTEGER PRIMARY KEY,
  restaurant_id  INTEGER NOT NULL REFERENCES restaurants(id),
  category_id    INTEGER NOT NULL REFERENCES menu_categories(id),
  station_id     INTEGER NOT NULL REFERENCES stations(id),
  name           TEXT    NOT NULL,
  description    TEXT    NOT NULL DEFAULT '',
  price          INTEGER NOT NULL CHECK (price >= 0),
  item_type      TEXT    NOT NULL DEFAULT 'FOOD' CHECK (item_type IN ('FOOD','DRINK','NON_FOOD')),
  image_path     TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  is_available   INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  deleted_at     TEXT,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL
);
CREATE INDEX ix_menu_items_category ON menu_items(category_id);
CREATE INDEX ix_menu_items_restaurant ON menu_items(restaurant_id, deleted_at);

CREATE TABLE orders (
  id                   INTEGER PRIMARY KEY,
  restaurant_id        INTEGER NOT NULL REFERENCES restaurants(id),
  order_number         INTEGER NOT NULL,
  table_id             INTEGER NOT NULL REFERENCES dining_tables(id),
  waiter_id            INTEGER NOT NULL REFERENCES users(id),
  guest_count          INTEGER NOT NULL DEFAULT 1 CHECK (guest_count BETWEEN 1 AND 100),
  note                 TEXT    NOT NULL DEFAULT '',
  lifecycle            TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle IN ('ACTIVE','COMPLETED','CANCELLED')),
  status               TEXT    NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN','IN_PROGRESS','PARTIALLY_READY','READY','DELIVERED','COMPLETED','CANCELLED')),
  subtotal             INTEGER NOT NULL DEFAULT 0,
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
  UNIQUE (restaurant_id, order_number)
);
-- One live (unreleased) order per table. This is what makes "two waiters open Table 5 at
-- the same moment" safe: the second INSERT fails and the service returns the first order.
CREATE UNIQUE INDEX ux_orders_live_table ON orders(table_id) WHERE released_at IS NULL;
CREATE INDEX ix_orders_business_date ON orders(restaurant_id, business_date);
CREATE INDEX ix_orders_status ON orders(restaurant_id, status);
CREATE INDEX ix_orders_waiter ON orders(waiter_id);

CREATE TABLE order_batches (
  id                 INTEGER PRIMARY KEY,
  order_id           INTEGER NOT NULL REFERENCES orders(id),
  batch_no           INTEGER NOT NULL,
  created_by         INTEGER NOT NULL REFERENCES users(id),
  client_request_id  TEXT    NOT NULL,
  submitted_at       TEXT    NOT NULL,
  UNIQUE (order_id, batch_no),
  UNIQUE (order_id, client_request_id)
);

CREATE TABLE order_items (
  id             INTEGER PRIMARY KEY,
  order_id       INTEGER NOT NULL REFERENCES orders(id),
  batch_id       INTEGER NOT NULL REFERENCES order_batches(id),
  menu_item_id   INTEGER NOT NULL REFERENCES menu_items(id),
  station_id     INTEGER NOT NULL REFERENCES stations(id),
  category_id    INTEGER NOT NULL REFERENCES menu_categories(id),
  item_name      TEXT    NOT NULL,
  unit_price     INTEGER NOT NULL CHECK (unit_price >= 0),
  quantity       INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  note           TEXT    NOT NULL DEFAULT '',
  status         TEXT    NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','PREPARING','READY','DELIVERED','CANCELLED')),
  version        INTEGER NOT NULL DEFAULT 1,
  created_by     INTEGER NOT NULL REFERENCES users(id),
  submitted_at   TEXT    NOT NULL,
  started_at     TEXT,
  ready_at       TEXT,
  delivered_at   TEXT,
  cancelled_at   TEXT,
  cancelled_by   INTEGER REFERENCES users(id),
  cancel_reason  TEXT,
  updated_at     TEXT    NOT NULL
);
CREATE INDEX ix_order_items_order ON order_items(order_id);
CREATE INDEX ix_order_items_station_status ON order_items(station_id, status);
CREATE INDEX ix_order_items_batch ON order_items(batch_id);

CREATE TABLE order_item_status_history (
  id             INTEGER PRIMARY KEY,
  order_item_id  INTEGER NOT NULL REFERENCES order_items(id),
  from_status    TEXT,
  to_status      TEXT    NOT NULL,
  changed_by     INTEGER NOT NULL REFERENCES users(id),
  changed_at     TEXT    NOT NULL
);
CREATE INDEX ix_item_history_item ON order_item_status_history(order_item_id);

CREATE TABLE audit_logs (
  id             INTEGER PRIMARY KEY,
  restaurant_id  INTEGER NOT NULL REFERENCES restaurants(id),
  user_id        INTEGER REFERENCES users(id),
  action         TEXT    NOT NULL,
  entity_type    TEXT    NOT NULL,
  entity_id      INTEGER,
  summary        TEXT    NOT NULL,
  metadata       TEXT,
  ip             TEXT,
  created_at     TEXT    NOT NULL
);
CREATE INDEX ix_audit_restaurant_time ON audit_logs(restaurant_id, created_at);
CREATE INDEX ix_audit_entity ON audit_logs(entity_type, entity_id);
