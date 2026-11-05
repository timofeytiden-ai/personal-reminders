/**
 * Application state: a tiny external store consumed with useSyncExternalStore.
 * All writes go through `commit`, which persists locally and notifies the
 * sync layer about locally-changed reminders.
 */
import { useSyncExternalStore } from 'react';
import { computeNextFireAt } from '../core/occurrences';
import { deviceZone, isValidZone } from '../core/dates';
import type { Reminder, Settings } from '../core/types';
import { kvGet, kvSetSoon } from './persist';

export type SyncStatus = 'off' | 'signed-out' | 'syncing' | 'synced' | 'offline' | 'error';

export interface AuthState {
  configured: boolean;
  userId: string | null;
  email: string | null;
}

export interface AppState {
  loaded: boolean;
  reminders: Record<string, Reminder>;
  settings: Settings;
  auth: AuthState;
  sync: { status: SyncStatus; lastSync: string | null; error: string | null };
  push: { supported: boolean; subscribed: boolean };
}

export const DEFAULT_SETTINGS: Settings = {
  name: 'Тимофей',
  greetings: { morning: 'Доброе утро', day: 'Добрый день', evening: 'Добрый вечер' },
  tzMode: 'auto',
  tzManual: 'Europe/Athens',
  theme: 'system',
  notifications: false,
  sound: true,
  defaultAlert: 0,
  allDayAlertTime: '09:00',
  updatedAt: new Date(0).toISOString(),
};

let state: AppState = {
  loaded: false,
  reminders: {},
  settings: DEFAULT_SETTINGS,
  auth: { configured: false, userId: null, email: null },
  sync: { status: 'off', lastSync: null, error: null },
  push: { supported: false, subscribed: false },
};

const listeners = new Set<() => void>();
const changeListeners = new Set<(ids: string[]) => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
}

/** Fires with ids of reminders changed locally (not from the server). */
export function onLocalChange(l: (ids: string[]) => void) {
  changeListeners.add(l);
  return () => {
    changeListeners.delete(l);
  };
}

export function effectiveZone(s: Settings = state.settings): string {
  if (s.tzMode === 'manual' && isValidZone(s.tzManual)) return s.tzManual;
  return deviceZone();
}

export function liveReminders(): Reminder[] {
  return Object.values(state.reminders).filter((r) => !r.deletedAt);
}

function withNextFire(r: Reminder): Reminder {
  const nf = computeNextFireAt(r, effectiveZone(), Date.now(), state.settings.allDayAlertTime);
  return nf === r.nextFireAt ? r : { ...r, nextFireAt: nf };
}

/**
 * Save reminders. `remote` = data came from the server (no re-upload,
 * last-write-wins by updatedAt).
 */
export function commit(list: Reminder[], opts: { remote?: boolean } = {}) {
  if (!list.length) return;
  const next = { ...state.reminders };
  const changed: string[] = [];
  for (const r0 of list) {
    const cur = next[r0.id];
    if (opts.remote && cur && cur.updatedAt > r0.updatedAt) continue;
    const r = opts.remote ? r0 : withNextFire(r0);
    next[r.id] = r;
    changed.push(r.id);
  }
  if (!changed.length) return;
  setState({ reminders: next });
  kvSetSoon('reminders', next);
  if (!opts.remote) changeListeners.forEach((l) => l(changed));
}

/** Recompute next notification times (e.g. after a time-zone change). */
export function refreshNextFire() {
  const changed: Reminder[] = [];
  for (const r of liveReminders()) {
    const nr = withNextFire(r);
    if (nr !== r) changed.push(nr);
  }
  if (changed.length) commit(changed);
}

export function saveSettings(patch: Partial<Settings>, opts: { remote?: boolean } = {}) {
  const settings = { ...state.settings, ...patch };
  if (!opts.remote) settings.updatedAt = new Date().toISOString();
  const zoneChanged = effectiveZone(settings) !== effectiveZone(state.settings) || settings.allDayAlertTime !== state.settings.allDayAlertTime;
  setState({ settings });
  kvSetSoon('settings', settings);
  if (zoneChanged) refreshNextFire();
  if (!opts.remote) settingsListeners.forEach((l) => l());
}

const settingsListeners = new Set<() => void>();
export function onSettingsChange(l: () => void) {
  settingsListeners.add(l);
  return () => {
    settingsListeners.delete(l);
  };
}

export async function loadLocal() {
  const [reminders, settings] = await Promise.all([
    kvGet<Record<string, Reminder>>('reminders'),
    kvGet<Settings>('settings'),
  ]);
  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    greetings: { ...DEFAULT_SETTINGS.greetings, ...(settings?.greetings || {}) },
  };
  setState({ reminders: reminders || {}, settings: merged, loaded: true });
}

export function replaceAll(reminders: Record<string, Reminder>) {
  setState({ reminders });
  kvSetSoon('reminders', reminders);
}
