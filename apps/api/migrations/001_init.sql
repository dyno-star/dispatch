-- 001_init.sql — core MVP schema.
-- Mirrors docs/system-design/04-data-model.md. Money is integer kobo (₦1 = 100 kobo).

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ─── Enums ──────────────────────────────────────────────────────────────
CREATE TYPE account_type   AS ENUM ('personal', 'business');
CREATE TYPE user_role      AS ENUM ('customer', 'rider', 'admin');
CREATE TYPE rider_status   AS ENUM ('pending', 'approved', 'rejected', 'suspended');
CREATE TYPE vehicle_type   AS ENUM ('bike', 'car', 'van');
CREATE TYPE document_kind  AS ENUM ('nin', 'licence', 'selfie', 'vehicle');
CREATE TYPE package_size   AS ENUM ('small', 'medium', 'large');
CREATE TYPE package_type   AS ENUM ('food', 'perishable', 'non_perishable', 'fragile', 'documents', 'clothing', 'other');
CREATE TYPE order_status   AS ENUM ('created', 'searching', 'accepted', 'to_pickup', 'picked_up', 'en_route',
                                    'delivered', 'completed', 'cancelled', 'expired', 'disputed', 'refunded');
CREATE TYPE offer_response AS ENUM ('pending', 'accepted', 'declined', 'expired', 'lost');
CREATE TYPE payment_status AS ENUM ('pending', 'succeeded', 'failed', 'refunded');
CREATE TYPE payout_status  AS ENUM ('pending', 'processing', 'paid', 'failed', 'held');
CREATE TYPE dispute_reason AS ENUM ('package_damaged', 'package_missing', 'rider_no_show', 'customer_unavailable',
                                    'wrong_address', 'payment_issue', 'misconduct', 'other');
CREATE TYPE dispute_status AS ENUM ('open', 'investigating', 'resolved_refund', 'resolved_paid', 'closed');

-- ─── People ─────────────────────────────────────────────────────────────
CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type          account_type NOT NULL DEFAULT 'personal',
  name          text NOT NULL,
  owner_user_id uuid,                      -- FK added after users exists
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id),
  phone        text NOT NULL UNIQUE,       -- E.164, e.g. +2348012345678
  name         text NOT NULL,
  role         user_role NOT NULL DEFAULT 'customer',
  rating_avg   numeric(3,2),
  rating_count integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{7,14}$')
);

ALTER TABLE accounts
  ADD CONSTRAINT accounts_owner_fk FOREIGN KEY (owner_user_id) REFERENCES users(id);

CREATE TABLE rider_profiles (
  user_id       uuid PRIMARY KEY REFERENCES users(id),
  status        rider_status NOT NULL DEFAULT 'pending',
  vehicle_type  vehicle_type NOT NULL DEFAULT 'bike',
  plate         text,
  bank_ref      text,                      -- gateway transfer-recipient code, never a raw account number
  online        boolean NOT NULL DEFAULT false,
  last_seen_at  timestamptz,
  approved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rider_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id    uuid NOT NULL REFERENCES rider_profiles(user_id),
  kind        document_kind NOT NULL,
  file_key    text NOT NULL,               -- object storage key, private bucket
  verified_by uuid REFERENCES users(id),
  verified_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rider_documents_rider_idx ON rider_documents (rider_id);

-- ─── Orders ─────────────────────────────────────────────────────────────
CREATE TABLE orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id),
  customer_id     uuid NOT NULL REFERENCES users(id),
  rider_id        uuid REFERENCES rider_profiles(user_id),
  status          order_status NOT NULL DEFAULT 'created',
  version         integer NOT NULL DEFAULT 0,          -- optimistic lock for accept / status changes

  pickup_point    geography(Point, 4326) NOT NULL,
  pickup_address  text NOT NULL,                        -- revealed to rider only after accept
  pickup_area     text NOT NULL,                        -- shown before accept, e.g. 'Lekki'
  dropoff_point   geography(Point, 4326) NOT NULL,
  dropoff_address text NOT NULL,
  dropoff_area    text NOT NULL,

  recipient_name  text NOT NULL,
  recipient_phone text NOT NULL,

  size            package_size NOT NULL,
  package_type    package_type NOT NULL,
  vehicle         vehicle_type NOT NULL DEFAULT 'bike',
  notes           text,
  photo_key       text,

  asap            boolean NOT NULL DEFAULT true,
  scheduled_at    timestamptz,
  deliver_by      timestamptz,

  distance_m      integer NOT NULL,
  price_kobo      bigint NOT NULL CHECK (price_kobo > 0),
  rider_payout_kobo bigint NOT NULL CHECK (rider_payout_kobo >= 0),

  idempotency_key text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT scheduled_needs_time CHECK (asap OR scheduled_at IS NOT NULL),
  CONSTRAINT rider_set_after_accept CHECK (
    status IN ('created', 'searching', 'cancelled', 'expired') OR rider_id IS NOT NULL
  )
);
CREATE INDEX orders_customer_idx ON orders (customer_id, created_at DESC);
CREATE INDEX orders_rider_idx    ON orders (rider_id, created_at DESC);
CREATE INDEX orders_status_idx   ON orders (status) WHERE status NOT IN ('completed', 'cancelled', 'expired', 'refunded');
CREATE INDEX orders_pickup_gix   ON orders USING gist (pickup_point);

CREATE TABLE order_events (
  id          bigserial PRIMARY KEY,
  order_id    uuid NOT NULL REFERENCES orders(id),
  from_status order_status,
  to_status   order_status NOT NULL,
  actor_id    uuid REFERENCES users(id),           -- null for system actions
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_idx ON order_events (order_id, id);

CREATE TABLE offers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES orders(id),
  rider_id     uuid NOT NULL REFERENCES rider_profiles(user_id),
  radius_km    numeric(4,1) NOT NULL,
  distance_m   integer NOT NULL,                    -- rider to pickup when offered
  response     offer_response NOT NULL DEFAULT 'pending',
  sent_at      timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  UNIQUE (order_id, rider_id)
);
CREATE INDEX offers_rider_pending_idx ON offers (rider_id) WHERE response = 'pending';

CREATE TABLE location_trail (
  id          bigserial PRIMARY KEY,
  order_id    uuid NOT NULL REFERENCES orders(id),
  point       geography(Point, 4326) NOT NULL,
  recorded_at timestamptz NOT NULL
);
CREATE INDEX location_trail_order_idx ON location_trail (order_id, recorded_at);

CREATE TABLE tracking_links (
  token      text PRIMARY KEY,                       -- 128-bit random, URL-safe
  order_id   uuid NOT NULL REFERENCES orders(id),
  revoked    boolean NOT NULL DEFAULT false,
  expires_at timestamptz,                            -- set when the order reaches a terminal status
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tracking_links_order_idx ON tracking_links (order_id);

-- ─── Money ──────────────────────────────────────────────────────────────
CREATE TABLE payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES orders(id),
  provider     text NOT NULL,
  provider_ref text NOT NULL UNIQUE,                 -- makes webhook processing idempotent
  amount_kobo  bigint NOT NULL CHECK (amount_kobo > 0),
  status       payment_status NOT NULL DEFAULT 'pending',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_order_idx ON payments (order_id);

-- Double-entry ledger: each money movement is a debit row and a matching credit row.
CREATE TABLE ledger_entries (
  id           bigserial PRIMARY KEY,
  txn_id       uuid NOT NULL,                        -- groups the rows of one movement
  order_id     uuid REFERENCES orders(id),
  account_code text NOT NULL,                        -- e.g. gateway_clearing, customer_held, rider_payable:<id>, platform_revenue
  debit_kobo   bigint NOT NULL DEFAULT 0 CHECK (debit_kobo >= 0),
  credit_kobo  bigint NOT NULL DEFAULT 0 CHECK (credit_kobo >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_side CHECK ((debit_kobo = 0) <> (credit_kobo = 0))
);
CREATE INDEX ledger_entries_txn_idx   ON ledger_entries (txn_id);
CREATE INDEX ledger_entries_order_idx ON ledger_entries (order_id);

CREATE TABLE payouts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id     uuid NOT NULL REFERENCES rider_profiles(user_id),
  amount_kobo  bigint NOT NULL CHECK (amount_kobo > 0),
  transfer_ref text UNIQUE,
  status       payout_status NOT NULL DEFAULT 'pending',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payouts_rider_idx ON payouts (rider_id, created_at DESC);

-- ─── Trust ──────────────────────────────────────────────────────────────
CREATE TABLE proofs (
  order_id       uuid PRIMARY KEY REFERENCES orders(id),
  pin_hash       text NOT NULL,
  pin_attempts   integer NOT NULL DEFAULT 0,
  pin_verified   boolean NOT NULL DEFAULT false,
  photo_key      text,
  photo_point    geography(Point, 4326),
  delivered_at   timestamptz
);

CREATE TABLE ratings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES orders(id),
  from_user  uuid NOT NULL REFERENCES users(id),
  to_user    uuid NOT NULL REFERENCES users(id),
  stars      smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, from_user)                         -- one rating per direction per order
);
CREATE INDEX ratings_to_user_idx ON ratings (to_user);

CREATE TABLE disputes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id),
  raised_by   uuid NOT NULL REFERENCES users(id),
  reason      dispute_reason NOT NULL,
  description text,
  status      dispute_status NOT NULL DEFAULT 'open',
  resolution  text,
  resolved_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX disputes_open_idx ON disputes (status) WHERE status IN ('open', 'investigating');
