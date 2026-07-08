-- Admin panel, этап 1 (Stories): Supabase Storage для медиа сторис
-- и прямое видео в stories.kind.
--
-- До: kind in ('image','video_cover') — видео только как обложка + ссылка на
-- внешний хостинг (youtube/vk/rutube/vimeo); Storage в проекте не использовался.
-- После:
--   • бакет story-media (public read) — фото и видеофайлы сторис, загрузка
--     из админки через signed upload URL (service role создаёт токен,
--     браузер грузит напрямую в Storage, минуя лимит тела Vercel);
--   • kind = 'video' — прямой видеофайл из Storage (video_url), проигрывается
--     в клиенте без внешнего хостинга; cover_url — опциональный постер.
-- Легаси-виды 'image'/'video_cover' сохраняются, RPC get_user_stories
-- менять не нужно (kind проходит сквозь неё как text).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'story-media',
  'story-media',
  true,
  209715200, -- 200 MB на файл
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm']
)
on conflict (id) do nothing;

-- Public read на объекты бакета (public-бакет отдаёт файлы по /object/public/*,
-- политика нужна для list/доступа через API с anon-ключом).
create policy "story_media_public_read" on storage.objects
  for select using (bucket_id = 'story-media');

-- Запись — только admin (загрузка идёт через service role из api/admin/uploads,
-- политика оставлена на случай прямой работы админа под своим JWT).
create policy "story_media_admin_write" on storage.objects
  for all
  using (bucket_id = 'story-media' and public.is_admin(auth.uid()))
  with check (bucket_id = 'story-media' and public.is_admin(auth.uid()));

alter table public.stories
  drop constraint if exists stories_kind_check;

alter table public.stories
  add constraint stories_kind_check
  check (kind in ('image', 'video', 'video_cover'));

comment on column public.stories.kind is
'image = фото; video = прямой видеофайл из Storage (video_url, опц. cover_url-постер); video_cover = легаси-обложка со ссылкой на внешний хостинг (video_provider + video_url).';
