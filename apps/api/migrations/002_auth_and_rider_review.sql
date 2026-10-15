-- 002_auth_and_rider_review.sql — MVP step 1: phone OTP login, refresh tokens, rider review.

-- One row per code sent. Only the newest unconsumed code for a phone can be used.
CREATE TABLE otp_codes (
  id          bigserial PRIMARY KEY,
  phone       text NOT NULL,                 -- E.164
  code_hash   text NOT NULL,                 -- HMAC-SHA256 of phone + code; the code itself is never stored
  attempts    integer NOT NULL DEFAULT 0,    -- locked after 5
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_phone_idx ON otp_codes (phone, created_at DESC);

-- Rotating refresh tokens. Each login starts a family; every refresh revokes the old token
-- and issues a new one in the same family. Reusing a revoked token revokes the whole family.
CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  family_id   uuid NOT NULL,
  token_hash  text NOT NULL UNIQUE,          -- SHA-256 of the token; the token itself is never stored
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by uuid REFERENCES refresh_tokens(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_idx   ON refresh_tokens (user_id);

-- Admin review of rider applications.
ALTER TABLE rider_profiles
  ADD COLUMN rejection_reason text,
  ADD COLUMN reviewed_by      uuid REFERENCES users(id),
  ADD COLUMN reviewed_at      timestamptz;

-- File details needed to serve documents back to admins.
ALTER TABLE rider_documents
  ADD COLUMN content_type text,
  ADD COLUMN size_bytes   integer;
