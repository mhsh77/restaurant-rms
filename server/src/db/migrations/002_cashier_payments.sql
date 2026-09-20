-- pragma: foreign_keys=off
-- Cashier role, payments, and payment state on orders.

-- 1) Allow the CASHIER role (SQLite cannot alter a CHECK constraint: rebuild the table).
CREATE TABLE roles_new (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE CHECK (code IN ('MANAGER','WAITER','KITCHEN','BAR','CASHIER')),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);
INSERT INTO roles_new (id, code, name, description) SELECT id, code, name, description FROM roles;
DROP TABLE roles;
ALTER TABLE roles_new RENAME TO roles;
-- Existing installations get the role row; a fresh database gets it from the seed.
INSERT INTO roles (code, name, description)
SELECT 'CASHIER', 'صندوقدار', 'صندوق: دریافت وجه و تسویه صورتحساب سفارش‌ها'
 WHERE EXISTS (SELECT 1 FROM roles);

-- 2) Settings: may an order be completed before it is fully paid?
ALTER TABLE restaurants ADD COLUMN require_payment_to_complete INTEGER NOT NULL DEFAULT 0;

-- 3) Cached payment state on orders (recomputed with the subtotal in the same transaction).
ALTER TABLE orders ADD COLUMN paid_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'UNPAID';
-- Orders completed before this feature existed were settled outside the system.
UPDATE orders SET paid_amount = subtotal, payment_status = 'PAID' WHERE lifecycle = 'COMPLETED';

-- 4) Payments. Several rows per order = split bill / mixed methods. Never deleted, only voided.
CREATE TABLE payments (
  id                 INTEGER PRIMARY KEY,
  restaurant_id      INTEGER NOT NULL REFERENCES restaurants(id),
  order_id           INTEGER NOT NULL REFERENCES orders(id),
  method             TEXT    NOT NULL CHECK (method IN ('CASH','CARD','OTHER')),
  amount             INTEGER NOT NULL CHECK (amount > 0),
  received_amount    INTEGER CHECK (received_amount IS NULL OR received_amount >= amount),
  reference          TEXT    NOT NULL DEFAULT '',
  client_request_id  TEXT    NOT NULL,
  business_date      TEXT    NOT NULL,
  created_by         INTEGER NOT NULL REFERENCES users(id),
  created_at         TEXT    NOT NULL,
  voided_at          TEXT,
  voided_by          INTEGER REFERENCES users(id),
  void_reason        TEXT,
  UNIQUE (order_id, client_request_id)
);
CREATE INDEX ix_payments_order ON payments(order_id);
CREATE INDEX ix_payments_day ON payments(restaurant_id, business_date);
