-- Android Restore Credentials (Zero-Tap Sign-In) — WebAuthn public keys per user.
-- One restore credential per user (Google Play requirement).

CREATE TABLE IF NOT EXISTS public.user_restore_credentials (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key bytea NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports text[] NOT NULL DEFAULT '{}',
  rp_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_restore_credentials_rp_id_idx
  ON public.user_restore_credentials (rp_id);

-- Short-lived WebAuthn challenges (registration + authentication).
CREATE TABLE IF NOT EXISTS public.restore_credential_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge text NOT NULL UNIQUE,
  user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  flow text NOT NULL CHECK (flow IN ('registration', 'authentication')),
  rp_id text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS restore_credential_challenges_expires_idx
  ON public.restore_credential_challenges (expires_at);

ALTER TABLE public.user_restore_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restore_credential_challenges ENABLE ROW LEVEL SECURITY;

-- Service role only (API routes use createServiceSupabase).
REVOKE ALL ON public.user_restore_credentials FROM anon, authenticated;
REVOKE ALL ON public.restore_credential_challenges FROM anon, authenticated;

COMMENT ON TABLE public.user_restore_credentials IS
  'Android Restore Credentials public keys for Zero-Tap Sign-In on device migration.';
COMMENT ON TABLE public.restore_credential_challenges IS
  'Ephemeral WebAuthn challenges for restore credential register/auth flows.';
