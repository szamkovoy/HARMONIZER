-- STT circuit breaker: shared Groq Whisper cooldown → OpenAI Whisper fallback.
-- Service-role only (no anon/authenticated policies).

create table if not exists public.stt_circuit_breaker (
  key text primary key,
  blocked_until timestamptz not null default '1970-01-01 00:00:00+00',
  consecutive_fallback_count integer not null default 0
    check (consecutive_fallback_count >= 0),
  last_error text null,
  updated_at timestamptz not null default now()
);

insert into public.stt_circuit_breaker (key)
values ('groq_whisper')
on conflict (key) do nothing;

alter table public.stt_circuit_breaker enable row level security;

comment on table public.stt_circuit_breaker is
  'Groq Whisper rate-limit circuit; Vercel API uses service role only.';
