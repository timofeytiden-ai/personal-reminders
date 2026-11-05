/**
 * Sends due Web Push notifications. Called every minute by Supabase pg_cron
 * (see supabase/schema.sql) with `Authorization: Bearer <CRON_SECRET>`.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { nextFire } from '../../../../src/core/occurrences';
import type { Reminder } from '../../../../src/core/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Row {
  id: string; user_id: string; title: string; notes: string; color: string; date: string; time: string | null;
  tz: string | null; repeat: Reminder['repeat']; alert_offset: number | null; paused: boolean;
  done: Record<string, string>; overrides: Reminder['overrides']; next_fire_at: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
}

function toReminder(row: Row): Reminder {
  return {
    id: row.id, title: row.title, notes: row.notes ?? '', color: row.color as Reminder['color'],
    date: String(row.date).slice(0, 10), time: row.time ? String(row.time).slice(0, 5) : null, tz: row.tz,
    repeat: row.repeat, alertOffset: row.alert_offset, paused: row.paused, done: row.done ?? {},
    overrides: row.overrides ?? {}, nextFireAt: row.next_fire_at, createdAt: row.created_at,
    updatedAt: row.updated_at, deletedAt: row.deleted_at,
  };
}

function bodyFor(time: string | null, offset: number | null, notes: string): string {
  const when = offset && offset > 0
    ? offset >= 1440 ? `Через ${Math.round(offset / 1440)} д.` : offset >= 60 ? `Через ${Math.round(offset / 60)} ч.` : `Через ${offset} мин`
    : time ? `Сейчас · ${time}` : 'Сегодня';
  return notes ? `${when} — ${notes.slice(0, 120)}` : when;
}

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!url || !serviceKey || !vapidPublic || !vapidPrivate) {
    return NextResponse.json({ error: 'server not configured' }, { status: 500 });
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', vapidPublic, vapidPrivate);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const now = Date.now();
  const { data: due, error } = await db
    .from('reminders')
    .select('*')
    .is('deleted_at', null)
    .eq('paused', false)
    .not('next_fire_at', 'is', null)
    .lte('next_fire_at', new Date(now + 20_000).toISOString())
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (due || []) as Row[];
  if (!rows.length) return NextResponse.json({ sent: 0 });

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const [{ data: profiles }, { data: subs }] = await Promise.all([
    db.from('profiles').select('user_id, timezone, settings').in('user_id', userIds),
    db.from('push_subscriptions').select('*').in('user_id', userIds),
  ]);
  const zoneOf = new Map<string, string>();
  const enabled = new Map<string, boolean>();
  const allDay = new Map<string, string>();
  type Profile = { user_id: string; timezone: string | null; settings: { notifications?: boolean; allDayAlertTime?: string } | null };
  type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
  for (const p of (profiles || []) as Profile[]) {
    zoneOf.set(p.user_id, p.timezone || 'UTC');
    enabled.set(p.user_id, p.settings?.notifications !== false);
    allDay.set(p.user_id, p.settings?.allDayAlertTime || '09:00');
  }

  let sent = 0;
  for (const row of rows) {
    const r = toReminder(row);
    const zone = zoneOf.get(row.user_id) || 'UTC';
    const allDayTime = allDay.get(row.user_id) || '09:00';
    // what is due right now?
    const firing = nextFire(r, new Date(row.next_fire_at!).getTime() - 1, zone, allDayTime);
    const following = nextFire(r, Math.max(now + 20_000, firing ? firing.at : now), zone, allDayTime);
    const newNext = following ? new Date(following.at).toISOString() : null;

    // claim the row so concurrent invocations don't double-send
    const { data: claimed } = await db
      .from('reminders')
      .update({ next_fire_at: newNext, last_notified_at: new Date(now).toISOString() })
      .eq('id', row.id)
      .eq('next_fire_at', row.next_fire_at!)
      .select('id');
    if (!claimed?.length) continue;
    if (!firing || enabled.get(row.user_id) === false) continue;
    if (now - firing.at > 15 * 60_000) continue; // too late, skip silently

    const ov = r.overrides?.[firing.key];
    const payload = JSON.stringify({
      title: ov?.title ?? r.title,
      body: bodyFor(firing.time, r.alertOffset, ov?.notes ?? r.notes),
      tag: `${r.id}|${firing.key}`,
      url: '/',
    });
    for (const s of ((subs || []) as Sub[]).filter((x) => x.user_id === row.user_id)) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('id', s.id);
      }
    }
  }
  return NextResponse.json({ sent, due: rows.length });
}

export const POST = handle;
export const GET = handle;
