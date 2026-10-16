-- 003_quotes_and_orders.sql — MVP step 2: price quotes and order creation.

-- A price locked for 10 minutes. An order is created from exactly one quote.
CREATE TABLE quotes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid NOT NULL REFERENCES users(id),
  pickup_point      geography(Point, 4326) NOT NULL,
  pickup_address    text NOT NULL,
  pickup_area       text NOT NULL,
  dropoff_point     geography(Point, 4326) NOT NULL,
  dropoff_address   text NOT NULL,
  dropoff_area      text NOT NULL,
  size              package_size NOT NULL,
  vehicle           vehicle_type NOT NULL,
  asap              boolean NOT NULL,
  scheduled_at      timestamptz,
  deliver_by        timestamptz,
  distance_m        integer NOT NULL,
  price_kobo        bigint NOT NULL CHECK (price_kobo > 0),
  rider_payout_kobo bigint NOT NULL CHECK (rider_payout_kobo >= 0),
  pricing           jsonb NOT NULL,                  -- the price settings used, for support questions
  expires_at        timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quote_scheduled_needs_time CHECK (asap OR scheduled_at IS NOT NULL)
);
CREATE INDEX quotes_customer_idx ON quotes (customer_id, created_at DESC);

ALTER TABLE orders
  ADD COLUMN quote_id     uuid UNIQUE REFERENCES quotes(id),
  ADD COLUMN request_hash text;                      -- detects an Idempotency-Key reused for a different request

-- Idempotency keys are chosen by clients, so they only need to be unique per customer.
ALTER TABLE orders DROP CONSTRAINT orders_idempotency_key_key;
ALTER TABLE orders ADD CONSTRAINT orders_customer_idempotency_key UNIQUE (customer_id, idempotency_key);
