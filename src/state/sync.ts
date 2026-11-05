/**
 * Cloud sync with Supabase (optional).
 *
 * Model: local-first. Every change is applied locally, queued in an outbox
 * (persisted in IndexedDB) and pushed when online. Remote changes arrive by
 * full pull (on start / focus / reconnect) and realtime subscriptions, and are
 * merged last-write-wins by `updatedAt`. Deletions are soft (`deletedAt`) so
 * they propagate to every device.
 */
import type { SupabaseClient, RealtimeChannel, User } from '@supabase/supabase-js';
import type { Reminder, Settings } from '../core/types';
import { kvGet, kvSet } from './persist';
import {
  commit, effectiveZone, getState, onLocalChange, onSettingsChange, saveSettings, setState,
} from './store';

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const cloudConfigured = !!(SB_URL && ANON);

let client: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;
let outbox = new Set<string>();
let flushing = false;
let flushAgain = false;

export function getClient() {
  return client;
}

export async function getAccessToken(): Promise<string | null> {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

/* ---------------- row mapping ---------------- */

interface Row {
  id: string;
  user_id: string;
  title: string;
  notes: string;
  color: string;
  date: string;
  time: string | null;
  tz: string | null;
  repeat: Reminder['repeat'];
  alert_offset: number | null;
  paused: boolean;
  done: Record<string, string>;
  overrides: Reminder['overrides'];
  next_fire_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function toRow(r: Reminder, userId: string): Row {
  return {
    id: r.id,
    user_id: userId,
    title: r.title,
    notes: r.notes,
    color: r.color,
    date: r.date,
    time: r.time,
    tz: r.tz,
    repeat: r.repeat,
    alert_offset: r.alertOffset,
    paused: r.paused,
    done: r.done,
    overrides: r.overrides,
    next_fire_at: r.nextFireAt,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    deleted_at: r.deletedAt,
  };
}

function normTs(s: string | null): string | null {
  return s ? new Date(s).toISOString() : null;
}

export function fromRow(row: Row): Reminder {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes ?? '',
    color: row.color as Reminder['color'],
    date: String(row.date).slice(0, 10),
    time: row.time ? String(row.time).slice(0, 5) : null,
    tz: row.tz,
    repeat: row.repeat ?? { freq: 'none', interval: 1 },
    alertOffset: row.alert_offset,
    paused: !!row.paused,
    done: row.done ?? {},
    overrides: row.overrides ?? {},
    nextFireAt: normTs(row.next_fire_at),
    createdAt: normTs(row.created_at)!,
    updatedAt: normTs(row.updated_at)!,
    deletedAt: normTs(row.deleted_at),
  };
}

/* ---------------- outbox ---------------- */

async function saveOutbox() {
  await kvSet('outbox', [...outbox]);
}

function setSync(patch: Partial<ReturnType<typeof getState>['sync']>) {
  setState((s) => ({ sync: { ...s.sync, ...patch } }));
}

export async function flush(): Promise<void> {
  const uid = getState().auth.userId;
  if (!client || !uid || !outbox.size) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setSync({ status: 'offline' });
    return;
  }
  if (flushing) {
    flushAgain = true;
    return;
  }
  flushing = true;
  setSync({ status: 'syncing' });
  try {
    const ids = [...outbox];
    const all = getState().reminders;
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200).map((id) => all[id]).filter(Boolean).map((r) => toRow(r, uid));
      if (batch.length) {
        const { error } = await client.from('reminders').upsert(batch, { onConflict: 'id' });
        if (error) throw error;
      }
      ids.slice(i, i + 200).forEach((id) => outbox.delete(id));
      await saveOutbox();
    }
    setSync({ status: 'synced', lastSync: new Date().toISOString(), error: null });
  } catch (e) {
    setSync({ status: 'error', error: e instanceof Error ? e.message : String(e) });
  } finally {
    flushing = false;
    if (flushAgain) {
      flushAgain = false;
      void flush();
    }
  }
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flush(), 400);
}

/* ---------------- pull & realtime ---------------- */

export async function pull(): Promise<void> {
  const uid = getState().auth.userId;
  if (!client || !uid) return;
  setSync({ status: 'syncing' });
  try {
    const rows: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client.from('reminders').select('*').eq('user_id', uid).range(from, from + 999);
      if (error) throw error;
      rows.push(...((data as Row[]) || []));
      if (!data || data.length < 1000) break;
    }
    const remote = rows.map(fromRow);
    const local = getState().reminders;
    const remoteIds = new Set(remote.map((r) => r.id));
    // local items the server doesn't know (or older on server) → upload
    for (const r of Object.values(local)) {
      if (!remoteIds.has(r.id)) outbox.add(r.id);
    }
    for (const r of remote) {
      const l = local[r.id];
      if (l && l.updatedAt > r.updatedAt) outbox.add(r.id);
    }
    commit(remote, { remote: true });
    await saveOutbox();
    setSync({ status: 'synced', lastSync: new Date().toISOString(), error: null });
    await flush();
  } catch (e) {
    setSync({ status: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

function subscribeRealtime(uid: string) {
  if (!client) return;
  if (channel) void client.removeChannel(channel);
  channel = client
    .channel('reminders-' + uid)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'reminders', filter: `user_id=eq.${uid}` },
      (payload: { new?: unknown }) => {
        const row = (payload.new || null) as Row | null;
        if (row && row.id) commit([fromRow(row)], { remote: true });
      },
    )
    .subscribe();
}

/* ---------------- profile (settings shared across devices) ---------------- */

type SharedSettings = Pick<Settings, 'name' | 'greetings' | 'notifications' | 'sound' | 'defaultAlert' | 'allDayAlertTime' | 'updatedAt'>;

function shared(s: Settings): SharedSettings {
  return {
    name: s.name, greetings: s.greetings, notifications: s.notifications, sound: s.sound,
    defaultAlert: s.defaultAlert, allDayAlertTime: s.allDayAlertTime, updatedAt: s.updatedAt,
  };
}

export async function pushProfile() {
  const uid = getState().auth.userId;
  if (!client || !uid) return;
  const s = getState().settings;
  await client.from('profiles').upsert(
    { user_id: uid, timezone: effectiveZone(s), settings: shared(s), updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  );
}

async function pullProfile() {
  const uid = getState().auth.userId;
  if (!client || !uid) return;
  const { data } = await client.from('profiles').select('settings').eq('user_id', uid).maybeSingle();
  const remote = (data?.settings || null) as SharedSettings | null;
  if (remote && remote.updatedAt > getState().settings.updatedAt) {
    saveSettings({ ...remote }, { remote: true });
  }
  await pushProfile();
}

/* ---------------- auth ---------------- */

async function onSignedIn(user: User) {
  setState({ auth: { configured: true, userId: user.id, email: user.email ?? null } });
  await pullProfile();
  await pull();
  subscribeRealtime(user.id);
}

function onSignedOut() {
  if (channel && client) void client.removeChannel(channel);
  channel = null;
  setState({ auth: { configured: true, userId: null, email: null } });
  setSync({ status: 'signed-out' });
}

export async function sendCode(email: string) {
  if (!client) throw new Error('Облако не настроено');
  const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyCode(email: string, token: string) {
  if (!client) throw new Error('Облако не настроено');
  const { error } = await client.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
}

export async function signOut() {
  if (!client) return;
  await flush();
  await client.auth.signOut();
}

/* ---------------- init ---------------- */

export async function initSync() {
  // remember local changes even before sign-in, so they upload later
  outbox = new Set((await kvGet<string[]>('outbox')) || []);
  onLocalChange((ids) => {
    ids.forEach((id) => outbox.add(id));
    void saveOutbox();
    scheduleFlush();
  });

  if (!cloudConfigured) {
    setState({ auth: { configured: false, userId: null, email: null } });
    setSync({ status: 'off' });
    return;
  }
  setState({ auth: { configured: true, userId: null, email: null } });
  setSync({ status: 'signed-out' });

  const { createClient } = await import('@supabase/supabase-js');
  client = createClient(SB_URL, ANON, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  let profileTimer: ReturnType<typeof setTimeout> | null = null;
  onSettingsChange(() => {
    if (profileTimer) clearTimeout(profileTimer);
    profileTimer = setTimeout(() => void pushProfile(), 800);
  });

  client.auth.onAuthStateChange((event: string, session: { user?: User } | null) => {
    // defer: calling Supabase from inside this callback can deadlock the auth lock
    setTimeout(() => {
      if (event === 'SIGNED_IN' && session?.user && session.user.id !== getState().auth.userId) {
        void onSignedIn(session.user);
      } else if (event === 'SIGNED_OUT') {
        onSignedOut();
      }
    }, 0);
  });
  const { data } = await client.auth.getSession();
  if (data.session?.user && data.session.user.id !== getState().auth.userId) await onSignedIn(data.session.user);

  window.addEventListener('online', () => void pull());
  window.addEventListener('offline', () => setSync({ status: 'offline' }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void pull();
      void pushProfile();
    }
  });
}
