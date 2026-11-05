/**
 * User-level actions. UI components and the AI assistant both call these.
 */
import {
  applyDelete, applyEdit, createReminder, postpone, setDone, setPaused,
} from '../core/mutations';
import type { Draft, EditScope, Reminder } from '../core/types';
import { commit, getState, replaceAll, liveReminders } from './store';

export function getReminder(id: string): Reminder | undefined {
  const r = getState().reminders[id];
  return r && !r.deletedAt ? r : undefined;
}

export function addReminder(draft: Draft): Reminder {
  const r = createReminder(draft);
  commit([r]);
  return getState().reminders[r.id];
}

export function editReminder(id: string, key: string | null, draft: Draft, scope: EditScope): Reminder[] {
  const r = getReminder(id);
  if (!r) return [];
  const { upserts } = applyEdit(r, key, draft, scope);
  commit(upserts);
  return upserts;
}

export function deleteReminder(id: string, key: string | null, scope: EditScope) {
  const r = getReminder(id);
  if (!r) return;
  commit([applyDelete(r, key, scope)]);
}

/** Restore a reminder snapshot (used for undo). */
export function restoreReminder(snapshot: Reminder) {
  commit([{ ...snapshot, updatedAt: new Date().toISOString() }]);
}

export function toggleDone(id: string, key: string, done?: boolean): boolean {
  const r = getReminder(id);
  if (!r) return false;
  const value = done ?? !r.done?.[key];
  commit([setDone(r, key, value)]);
  return value;
}

export function postponeOccurrence(id: string, key: string, date: string, time: string | null) {
  const r = getReminder(id);
  if (!r) return;
  commit([postpone(r, key, date, time)]);
}

export function togglePaused(id: string) {
  const r = getReminder(id);
  if (!r) return;
  commit([setPaused(r, !r.paused)]);
}

/* ---------- import / export ---------- */

export function exportJson(): string {
  return JSON.stringify(
    { app: 'reminders', version: 1, exportedAt: new Date().toISOString(), settings: getState().settings, reminders: liveReminders() },
    null,
    2,
  );
}

export function importJson(text: string): number {
  const data = JSON.parse(text);
  const list: Reminder[] = Array.isArray(data) ? data : data.reminders;
  if (!Array.isArray(list)) throw new Error('Неверный формат файла');
  const valid = list.filter((r) => r && typeof r.id === 'string' && typeof r.title === 'string' && typeof r.date === 'string');
  const now = new Date().toISOString();
  commit(valid.map((r) => ({
    done: {}, overrides: {}, notes: '', color: 'sky', time: null, tz: null, alertOffset: 0, paused: false,
    repeat: { freq: 'none', interval: 1 }, nextFireAt: null, createdAt: now, deletedAt: null,
    ...(r as Partial<Reminder>),
    updatedAt: now,
  })) as Reminder[]);
  return valid.length;
}

/** Soft-delete everything (propagates to the cloud). */
export function wipeAll() {
  const now = new Date().toISOString();
  commit(liveReminders().map((r) => ({ ...r, deletedAt: now, updatedAt: now })));
}

export function hardResetLocal() {
  replaceAll({});
}
