ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
CREATE TABLE account_tokens (
  token_hash text PRIMARY KEY CHECK (length(token_hash)=64),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('reset_password','verify_email')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX account_tokens_owner_idx ON account_tokens(user_id,purpose);
CREATE UNIQUE INDEX account_tokens_active_idx ON account_tokens(user_id,purpose) WHERE consumed_at IS NULL;
