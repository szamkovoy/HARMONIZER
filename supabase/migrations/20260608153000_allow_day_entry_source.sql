alter table public.conversations
  drop constraint if exists conversations_entry_source_check;

alter table public.conversations
  add constraint conversations_entry_source_check
  check (
    entry_source in (
      'home',
      'day',
      'event_reminder',
      'practice_discuss',
      'stories',
      'onboarding'
    )
  );
