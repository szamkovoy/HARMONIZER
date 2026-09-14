-- email_automation_welcome_candidates is a pure SELECT; mark it STABLE so PostgREST
-- serves it via GET /rest/v1/rpc/... (read-only transaction) — the runner now calls it
-- with `rpc(..., { get: true })` so the gateway-timeout retry for idempotent reads applies.
alter function public.email_automation_welcome_candidates(uuid, timestamptz, uuid) stable;
