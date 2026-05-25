create table if not exists public.profile_report_snapshots (
  user_id            uuid primary key references public.users(id) on delete cascade,
  active_days_count  integer not null default 0,
  cumulative_matrix  jsonb not null default '[]'::jsonb,
  visual_matrix      jsonb not null default '[]'::jsonb,
  life_line_points   jsonb not null default '[]'::jsonb,
  last_rolled_date   date,
  snapshot_version   integer not null default 1,
  updated_at         timestamptz not null default now()
);

create index if not exists idx_daily_matrices_user_source_date
  on public.daily_matrices (user_id, source, local_date desc);

alter table public.profile_report_snapshots enable row level security;

drop policy if exists profile_report_snapshots_self on public.profile_report_snapshots;
create policy profile_report_snapshots_self on public.profile_report_snapshots for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists profile_report_snapshots_set_updated_at on public.profile_report_snapshots;
create trigger profile_report_snapshots_set_updated_at
  before update on public.profile_report_snapshots
  for each row execute function public.set_updated_at();
