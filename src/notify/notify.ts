/**
 * Notifications.
 *
 * 1. Foreground scheduler: while the app is open it checks every 15 s and
 *    shows a system notification + in-app banner (+ optional sound).
 * 2. Web Push (server): when signed in to the cloud and subscribed, the
 *    /api/push/dispatch endpoint (called every minute by Supabase pg_cron)
 *    delivers notifications even when the app is closed. On iPhone this
 *    requires iOS 16.4+ and the app installed to the Home Screen.
 * Delivery while closed depends on the OS/browser and is never guaranteed.
 */
import { nextFire } from '../core/occurrences';
import { getState, liveReminders, effectiveZone, setState } from '../state/store';
import { getClient } from '../state/sync';

export type NotifSupport = 'unsupported' | 'needs-install' | 'default' | 'granted' | 'denied';

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function notificationSupport(): NotifSupport {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('Notification' in window)) return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  return Notification.permission as NotifSupport;
}

export async function requestPermission(): Promise<NotifSupport> {
  if (!('Notification' in window)) return notificationSupport();
  const p = await Notification.requestPermission();
  return p as NotifSupport;
}

let swReg: ServiceWorkerRegistration | null = null;

export async function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    swReg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    setState({ push: { ...getState().push, supported: 'PushManager' in window && !!VAPID } });
    return swReg;
  } catch {
    return null;
  }
}

export async function showSystemNotification(title: string, body: string, tag: string) {
  if (notificationSupport() !== 'granted') return;
  const opts: NotificationOptions = { body, tag, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', data: { url: '/' } };
  try {
    const reg = swReg || (await navigator.serviceWorker?.getRegistration());
    if (reg) return void (await reg.showNotification(title, opts));
  } catch {
    /* fall through */
  }
  try {
    new Notification(title, opts);
  } catch {
    /* some browsers only allow SW notifications */
  }
}

/* ---------------- sound ---------------- */

let audioCtx: AudioContext | null = null;
export function playChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = audioCtx || new Ctx();
    const ctx = audioCtx;
    const t = ctx.currentTime;
    [880, 1318.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.16);
      g.gain.linearRampToValueAtTime(0.18, t + i * 0.16 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.9);
      o.connect(g).connect(ctx.destination);
      o.start(t + i * 0.16);
      o.stop(t + i * 0.16 + 1);
    });
  } catch {
    /* audio blocked until user interaction */
  }
}

/** Unlock audio on first interaction (iOS requirement). */
export function primeAudio() {
  const unlock = () => {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = audioCtx || new Ctx();
      void audioCtx.resume();
    } catch {
      /* ignore */
    }
    window.removeEventListener('pointerdown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
}

/* ---------------- foreground scheduler ---------------- */

export interface FiredEvent {
  rid: string;
  key: string;
  title: string;
  body: string;
}

const fireListeners = new Set<(e: FiredEvent) => void>();
export function onFire(l: (e: FiredEvent) => void) {
  fireListeners.add(l);
  return () => {
    fireListeners.delete(l);
  };
}

function bodyFor(time: string | null, offset: number | null, notes: string): string {
  const when = offset && offset > 0
    ? offset >= 1440 ? `Через ${Math.round(offset / 1440)} д.` : offset >= 60 ? `Через ${Math.round(offset / 60)} ч.` : `Через ${offset} мин`
    : time ? `Сейчас · ${time}` : 'Сегодня';
  return notes ? `${when} — ${notes.slice(0, 120)}` : when;
}

let lastCheck = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

function check() {
  const now = Date.now();
  const s = getState().settings;
  const zone = effectiveZone(s);
  for (const r of liveReminders()) {
    const n = nextFire(r, lastCheck - 1, zone, s.allDayAlertTime);
    if (n && n.at <= now && n.at > lastCheck - 1 && now - n.at < 10 * 60_000) {
      const ov = r.overrides?.[n.key];
      const title = ov?.title ?? r.title;
      const ev: FiredEvent = { rid: r.id, key: n.key, title, body: bodyFor(n.time, r.alertOffset, ov?.notes ?? r.notes) };
      fireListeners.forEach((l) => l(ev));
      if (s.notifications) void showSystemNotification(title, ev.body, `${r.id}|${n.key}`);
      if (s.sound && document.visibilityState === 'visible') playChime();
    }
  }
  lastCheck = now;
}

export function startScheduler() {
  if (timer) return;
  lastCheck = Date.now();
  timer = setInterval(check, 15_000);
  document.addEventListener('visibilitychange', () => {
    // don't replay everything that fired while the app was in background
    if (document.visibilityState === 'visible') lastCheck = Math.max(lastCheck, Date.now() - 60_000);
  });
}

/* ---------------- Web Push ---------------- */

function b64ToBytes(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushAvailable(): boolean {
  return !!VAPID && typeof window !== 'undefined' && 'PushManager' in window && 'serviceWorker' in navigator;
}

export async function subscribePush(): Promise<boolean> {
  const client = getClient();
  const uid = getState().auth.userId;
  if (!pushAvailable() || !client || !uid) return false;
  const reg = swReg || (await navigator.serviceWorker.ready);
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID) as BufferSource });
  }
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { error } = await client.from('push_subscriptions').upsert(
    { user_id: uid, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, user_agent: navigator.userAgent.slice(0, 200) },
    { onConflict: 'endpoint' },
  );
  if (error) throw error;
  setState({ push: { ...getState().push, subscribed: true } });
  return true;
}

export async function unsubscribePush() {
  try {
    const reg = swReg || (await navigator.serviceWorker.getRegistration());
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      const client = getClient();
      if (client) await client.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
  } finally {
    setState({ push: { ...getState().push, subscribed: false } });
  }
}

export async function refreshPushState() {
  if (!pushAvailable()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    setState({ push: { supported: true, subscribed: !!sub && !!getState().auth.userId } });
  } catch {
    /* ignore */
  }
}
