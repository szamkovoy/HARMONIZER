-- Ensure story-media bucket keeps 200 MB per-object limit even if the bucket already existed
-- when 20260708120000 ran with ON CONFLICT DO NOTHING (default global limit was still 50 MB).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'story-media',
  'story-media',
  true,
  209715200, -- 200 MB
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
