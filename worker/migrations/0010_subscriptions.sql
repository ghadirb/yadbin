-- v1.4: Subscriptions, 7-day Trial and payment abstraction. Additive only: existing tables keep their meaning.
-- Source of truth for access is this database. The client never sends a plan, a price or an expiry.

-- Trial: one per account, ever. trial_used flips to 1 in the same atomic UPDATE that starts the trial,
-- so deleting local app data / reinstalling / re-registering the same account can never start a second one.
ALTER TABLE teachers ADD COLUMN trial_started_at TEXT;
ALTER TABLE teachers ADD COLUMN trial_expires_at TEXT;
ALTER TABLE teachers ADD COLUMN trial_used INTEGER NOT NULL DEFAULT 0;

-- Sellable plans. price_amount NULL = "price not decided yet" (payments stay unavailable for that plan).
-- Prices are data, never code: change a row, not the Worker.
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('monthly','yearly')),
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  price_amount INTEGER CHECK (price_amount IS NULL OR price_amount > 0),
  currency TEXT NOT NULL DEFAULT 'IRR',
  -- Product id of this plan inside an app store (Myket «شناسه محصول»). Store products are consumable: one purchase = one period.
  store_sku TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
-- store_sku stays NULL until the products are created in the Myket panel (then: UPDATE plans SET store_sku = '...' WHERE id = '...').
INSERT INTO plans (id, name, period, duration_days, price_amount, currency, active, sort_order) VALUES
  ('pro_monthly', 'اشتراک حرفه‌ای ماهانه', 'monthly', 30, NULL, 'IRR', 1, 1),
  ('pro_yearly', 'اشتراک حرفه‌ای سالانه', 'yearly', 365, NULL, 'IRR', 1, 2);

-- One row per payment attempt. status moves pending -> verified | failed | expired and never back.
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  provider TEXT NOT NULL,
  -- Redirect gateways: amount is copied from plans at creation and the gateway's reported amount must equal it.
  -- Store purchases (Myket): the store sets the price from the product, so amount is NULL (the SKU is what is checked).
  amount INTEGER,
  currency TEXT,
  -- authority: gateway transaction id, or for stores the server-issued developerPayload (random, one-time, bound to this teacher+plan)
  authority TEXT,
  -- ref_id: the gateway's / store's own transaction id (Myket purchase token) — unique, so it can be credited only once
  ref_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','failed','expired')),
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  verified_at TEXT
);
CREATE INDEX idx_payments_teacher ON payments(teacher_id, created_at);
-- A gateway authority identifies exactly one payment; a duplicate callback finds the same row.
CREATE UNIQUE INDEX uq_payments_authority ON payments(provider, authority) WHERE authority IS NOT NULL;
-- The same gateway transaction can never be credited twice.
CREATE UNIQUE INDEX uq_payments_ref ON payments(provider, ref_id) WHERE ref_id IS NOT NULL;

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL CHECK (status IN ('pending','active','expired','canceled')),
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  provider TEXT,
  transaction_id TEXT,
  authority TEXT,
  payment_status TEXT,
  -- UNIQUE: a payment activates at most one subscription period, however many times its callback arrives
  payment_id TEXT UNIQUE REFERENCES payments(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_subscriptions_teacher ON subscriptions(teacher_id, expires_at);
CREATE UNIQUE INDEX uq_subscriptions_tx ON subscriptions(provider, transaction_id) WHERE transaction_id IS NOT NULL;

-- Monthly usage counters for metered features (AI). period = 'YYYY-MM' in UTC.
CREATE TABLE usage_counters (
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  period TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (teacher_id, feature, period)
);
