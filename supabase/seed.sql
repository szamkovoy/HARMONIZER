-- =============================================================================
-- HARMONIZER — seed: справочник чакр + каталог дыхательных практик.
-- Идемпотентен (ON CONFLICT DO NOTHING/UPDATE) — безопасно запускать повторно.
-- =============================================================================

-- 7 чакр
insert into public.chakras (id, slug, name, color_hex) values
  (1, 'muladhara',    '{"ru":"Муладхара","en":"Muladhara"}',       '#E53935'),
  (2, 'svadhisthana', '{"ru":"Свадхистана","en":"Svadhisthana"}',  '#FB8C00'),
  (3, 'manipura',     '{"ru":"Манипура","en":"Manipura"}',         '#FDD835'),
  (4, 'anahata',      '{"ru":"Анахата","en":"Anahata"}',           '#43A047'),
  (5, 'vishuddha',    '{"ru":"Вишуддха","en":"Vishuddha"}',        '#29B6F6'),
  (6, 'ajna',         '{"ru":"Аджна","en":"Ajna"}',                '#3949AB'),
  (7, 'sahasrara',    '{"ru":"Сахасрара","en":"Sahasrara"}',       '#8E24AA')
on conflict (id) do update set
  slug      = excluded.slug,
  name      = excluded.name,
  color_hex = excluded.color_hex;

-- =============================================================================
-- Дыхательные практики — синхронизированы с BREATH_PRACTICES
-- (modules/breath/core/practices.ts) + i18n названиями.
-- params.indicatorKind / channelMode / normalBaseBeats — для клиента.
-- =============================================================================

insert into public.practices
  (slug, kind, title, description, default_duration_sec,
   min_duration_sec, max_duration_sec, params, rating, is_active, version)
values
  ('coherent', 'breath',
   '{"ru":"Когерентное дыхание","en":"Coherent breathing"}',
   '{"ru":"Сама-Вритти. Резонансная частота парасимпатической вариабельности HRV.","en":"Sama Vritti. Resonant frequency for parasympathetic HRV."}',
   600, 120, 1800,
   '{"indicatorKind":"bar","channelMode":"both","normalBaseBeats":6,"minBaseBeats":1,"maxBaseBeats":10}',
   0.9, true, 1),

  ('nadi-shodhana', 'breath',
   '{"ru":"Попеременное дыхание ноздрями","en":"Alternate nostril breathing"}',
   '{"ru":"Нади Шодхана. Баланс полушарий, очищение каналов ида/пингала.","en":"Nadi Shodhana. Hemispheric balance, channel purification."}',
   480, 120, 1200,
   '{"indicatorKind":"dual-bar","channelMode":"alternating","normalBaseBeats":6,"minBaseBeats":1,"maxBaseBeats":10}',
   0.85, true, 1),

  ('surya-bhedana', 'breath',
   '{"ru":"Дыхание правой ноздрёй","en":"Right-nostril breathing"}',
   '{"ru":"Сурья Бхедана. Активация, солнечный канал.","en":"Surya Bhedana. Activation, solar channel."}',
   300, 120, 900,
   '{"indicatorKind":"dual-bar","channelMode":"right","normalBaseBeats":6,"minBaseBeats":1,"maxBaseBeats":10}',
   0.7, true, 1),

  ('chandra-bhedana', 'breath',
   '{"ru":"Дыхание левой ноздрёй","en":"Left-nostril breathing"}',
   '{"ru":"Чандра Бхедана. Охлаждение, лунный канал.","en":"Chandra Bhedana. Cooling, lunar channel."}',
   300, 120, 900,
   '{"indicatorKind":"dual-bar","channelMode":"left","normalBaseBeats":6,"minBaseBeats":1,"maxBaseBeats":10}',
   0.7, true, 1),

  ('square', 'breath',
   '{"ru":"Дыхание ''Квадрат''","en":"Square breathing"}',
   '{"ru":"Чатуранга пранаяма 1:1:1:1. Стабильность, заземление.","en":"Chaturanga pranayama 1:1:1:1. Stability, grounding."}',
   480, 120, 1200,
   '{"indicatorKind":"square","channelMode":"both","normalBaseBeats":4,"minBaseBeats":1,"maxBaseBeats":10}',
   0.75, true, 1),

  ('triangle-up', 'breath',
   '{"ru":"Треугольник вершиной вверх","en":"Triangle (apex up)"}',
   '{"ru":"Висама-Вритти · Бахир Кумбхака: вдох-выдох-задержка.","en":"Vishama Vritti with post-exhalation retention."}',
   360, 120, 900,
   '{"indicatorKind":"triangle-up","channelMode":"both","normalBaseBeats":5,"minBaseBeats":1,"maxBaseBeats":10}',
   0.6, true, 1),

  ('triangle-down', 'breath',
   '{"ru":"Треугольник вершиной вниз","en":"Triangle (apex down)"}',
   '{"ru":"Висама-Вритти · Антар Кумбхака: вдох-задержка-выдох.","en":"Vishama Vritti with post-inhalation retention."}',
   360, 120, 900,
   '{"indicatorKind":"triangle-down","channelMode":"both","normalBaseBeats":5,"minBaseBeats":1,"maxBaseBeats":10}',
   0.6, true, 1)
on conflict (slug) do update set
  title                 = excluded.title,
  description           = excluded.description,
  default_duration_sec  = excluded.default_duration_sec,
  min_duration_sec      = excluded.min_duration_sec,
  max_duration_sec      = excluded.max_duration_sec,
  params                = excluded.params,
  rating                = excluded.rating,
  is_active             = excluded.is_active,
  updated_at            = now();

-- =============================================================================
-- Маппинг практика → чакра (первичная + вторичные).
-- Первичные цвета — для быстрых рекомендаций; вторичные — для расширенного
-- подбора по запросу LLM/алгоритма.
-- Если захотите скорректировать связи — правьте здесь или через админку.
-- =============================================================================

-- Удаляем старые связи по слагу, чтобы правки подхватились при повторном seed
delete from public.practice_chakras
  where practice_id in (
    select id from public.practices
    where slug in ('coherent','nadi-shodhana','surya-bhedana',
                   'chandra-bhedana','square','triangle-up','triangle-down')
  );

insert into public.practice_chakras (practice_id, chakra_id, is_primary, weight)
select p.id, v.chakra_id, v.is_primary, v.weight
from (values
  -- coherent: сердечный резонанс + корона
  ('coherent',        4::smallint, true,  1.0::numeric),
  ('coherent',        7::smallint, false, 0.5),
  -- nadi-shodhana: аджна (баланс полушарий), плюс сердечная
  ('nadi-shodhana',   6::smallint, true,  1.0),
  ('nadi-shodhana',   4::smallint, false, 0.5),
  -- surya-bhedana: манипура (огонь/активация)
  ('surya-bhedana',   3::smallint, true,  1.0),
  ('surya-bhedana',   1::smallint, false, 0.4),
  -- chandra-bhedana: свадхистана (охлаждение), аджна (интуиция)
  ('chandra-bhedana', 2::smallint, true,  1.0),
  ('chandra-bhedana', 6::smallint, false, 0.5),
  -- square: муладхара (стабильность)
  ('square',          1::smallint, true,  1.0),
  ('square',          3::smallint, false, 0.4),
  -- triangle-up: вишуддха (выражение, пауза в пустоте)
  ('triangle-up',     5::smallint, true,  1.0),
  ('triangle-up',     4::smallint, false, 0.5),
  -- triangle-down: анахата (наполнение, пауза после вдоха)
  ('triangle-down',   4::smallint, true,  1.0),
  ('triangle-down',   5::smallint, false, 0.5)
) as v(slug, chakra_id, is_primary, weight)
join public.practices p on p.slug = v.slug
on conflict (practice_id, chakra_id) do nothing;
