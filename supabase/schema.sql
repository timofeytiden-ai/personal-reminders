-- ============================================================
-- Personal Reminders — Supabase schema
-- Run in Supabase Dashboard → SQL Editor (whole file, once).
-- ============================================================

-- ---------- reminders ----------
create table if not exists public.reminders (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title         text not null,
  notes         text not null default '',
  color         text not null default 'sky',
  date          date not null,                 -- first occurrence (wall date)
  time          text,                          -- 'HH:mm' wall time, null = all day
  tz            text,                          -- IANA zone if pinned, null = floating
  repeat        jsonb not null default '{"freq":"none","interval":1}'::jsonb,
  alert_offset  integer,                       -- minutes before; null = no notification
  paused        boolean not null default false,
  done          jsonb not null default '{}'::jsonb,   -- { "YYYY-MM-DD": completedAt }
  overrides     jsonb not null default '{}'::jsonb,   -- per-occurrence changes
  next_fire_at  timestamptz,                   -- next push instant (computed)
  last_notified_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists reminders_user_idx on public.reminders (user_id);
create index if not exists reminders_fire_idx on public.reminders (next_fire_at)
  where deleted_at is null and paused = false and next_fire_at is not null;

alter table public.reminders enable row level security;

drop policy if exists "own reminders select" on public.reminders;
drop policy if exists "own reminders insert" on public.reminders;
drop policy if exists "own reminders update" on public.reminders;
drop policy if exists "own reminders delete" on public.reminders;
create policy "own reminders select" on public.reminders for select using (auth.uid() = user_id);
create policy "own reminders insert" on public.reminders for insert with check (auth.uid() = user_id);
create policy "own reminders update" on public.reminders for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own reminders delete" on public.reminders for delete using (auth.uid() = user_id);

-- ---------- profiles (settings shared across devices + current time zone) ----------
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  timezone   text not null default 'UTC',
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- web push subscriptions (one per device) ----------
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- realtime (live sync between devices) ----------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'reminders'
  ) then
    alter publication supabase_realtime add table public.reminders;
  end if;
end $$;

-- ============================================================
-- Push delivery every minute (pg_cron + pg_net).
-- 1) Database → Extensions: enable "pg_cron" and "pg_net".
-- 2) Replace the URL and the secret below (same value as CRON_SECRET in Vercel),
--    then run this block.
-- ============================================================
-- select cron.schedule(
--   'dispatch-reminders',
--   '* * * * *',
--   $$
--   select net.http_post(
--     url     := 'https://YOUR-APP.vercel.app/api/push/dispatch',
--     headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET', 'Content-Type', 'application/json'),
--     body    := '{}'::jsonb
--   );
--   $$
-- );
--
-- To stop:  select cron.unschedule('dispatch-reminders');
