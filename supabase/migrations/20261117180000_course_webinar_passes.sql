-- Existing webinar passes may originate either in a payment or in a normal course grant.
-- This migration creates no grant, registration or letter for the prepared rehearsal.
alter table public.courses add column webinar_extra_days integer not null default 5 check(webinar_extra_days>0);
alter table public.webinar_passes alter column contract_id drop not null;
alter table public.webinar_passes add column course_enrollment_id uuid unique references public.course_enrollments(id) on delete cascade;
alter table public.webinar_passes add constraint webinar_pass_one_source check(num_nonnulls(contract_id,course_enrollment_id)=1);

create or replace function public.apply_webinar_passes(p_user_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  p record;
  w record;
  v_used integer;
  v_count integer := 0;
  v_n integer;
begin
  for p in
    select wp.id, wp.user_id, wp.credits, wp.valid_from, wp.valid_until
    from public.webinar_passes wp
    left join public.payment_contracts pc on pc.contract_id = wp.contract_id
    left join public.course_enrollments ce on ce.id = wp.course_enrollment_id
    where wp.status = 'active'
      and ((wp.contract_id is not null and pc.status = 'active')
        or (wp.course_enrollment_id is not null and ce.status = 'active' and ce.mode = 'normal' and ce.user_id = wp.user_id))
      and wp.valid_until > now() - interval '1 hour'
      and (p_user_id is null or wp.user_id = p_user_id)
    order by (wp.course_enrollment_id is null), wp.valid_until, wp.id
  loop
    select count(*) into v_used
    from public.webinar_registrations r
    where r.pass_id = p.id;
    if v_used >= p.credits then
      continue;
    end if;

    for w in
      select wb.id
      from public.webinars wb
      where wb.is_published
        and wb.starts_at >= p.valid_from
        and wb.starts_at < p.valid_until
        and wb.starts_at > now() - interval '1 hour'
        and not exists (
          select 1 from public.webinar_registrations r
          where r.webinar_id = wb.id and r.user_id = p.user_id
        )
      order by wb.starts_at
      limit (p.credits - v_used)
    loop
      insert into public.webinar_registrations (webinar_id, user_id, pass_id)
      values (w.id, p.user_id, p.id)
      on conflict (webinar_id, user_id) do nothing;
      get diagnostics v_n = row_count;
      v_count := v_count + v_n;
    end loop;
  end loop;

  return v_count;
end;
$function$;


create function public.sync_course_webinar_pass() returns trigger
language plpgsql security definer set search_path=public,extensions as $$
declare v_last timestamptz;v_until timestamptz;v_extra integer;
begin
 if tg_op='DELETE' then
  delete from webinar_registrations where pass_id in(select id from webinar_passes where course_enrollment_id=old.id);
  delete from webinar_passes where course_enrollment_id=old.id;
  return old;
 end if;
 if new.status<>'active' or new.user_id is null or new.mode<>'normal' then
  delete from webinar_registrations where pass_id in(select id from webinar_passes where course_enrollment_id=new.id);
  update webinar_passes set status='revoked' where course_enrollment_id=new.id;
  return new;
 end if;
 select webinar_extra_days into v_extra from courses where slug=new.course_slug;
 select (s.item->>'opensAt')::timestamptz into v_last
 from jsonb_array_elements(new.schedule) with ordinality s(item,n) order by n desc limit 1;
 v_until:=((v_last at time zone new.timezone)+make_interval(days=>v_extra)) at time zone new.timezone;
 if v_until is null or new.started_at is null or v_until<=new.started_at then raise exception 'Invalid course webinar window';end if;
 insert into webinar_passes(user_id,course_enrollment_id,credits,valid_from,valid_until,status)
 values(new.user_id,new.id,1000000,new.started_at,v_until,'active')
 on conflict(course_enrollment_id) do update set user_id=excluded.user_id,valid_from=excluded.valid_from,valid_until=excluded.valid_until,status='active';
 perform public.apply_webinar_passes(new.user_id);
 return new;
end $$;
revoke all on function public.sync_course_webinar_pass() from public,anon,authenticated;
create trigger course_webinar_window after insert or update of status,started_at,schedule,timezone,user_id,mode on public.course_enrollments
 for each row execute function public.sync_course_webinar_pass();
create trigger course_webinar_cleanup before delete on public.course_enrollments
 for each row execute function public.sync_course_webinar_pass();
