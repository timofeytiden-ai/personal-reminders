/**
 * Pure reminder transformations: create, edit with scope, delete with scope,
 * complete, postpone, pause. Each returns new objects (never mutates input).
 */
import { addDays, cmp, diffDays, isValidDate, isValidTime, isValidZone } from './dates';
import { hasDatesFrom, isRecurring, normalizeRule } from './recurrence';
import { COLOR_KEYS } from './colors';
import type { ColorKey, Draft, EditScope, Override, Reminder } from './types';

export function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const nowIso = () => new Date().toISOString();

export function sanitizeDraft(d: Draft): Draft {
  const date = isValidDate(d.date) ? d.date : new Date().toISOString().slice(0, 10);
  const time = d.time && isValidTime(d.time) ? d.time : null;
  return {
    title: (d.title || '').trim().slice(0, 200) || 'Без названия',
    notes: (d.notes || '').slice(0, 4000),
    color: (COLOR_KEYS.includes(d.color) ? d.color : 'sky') as ColorKey,
    date,
    time,
    tz: time && d.tz && isValidZone(d.tz) ? d.tz : null,
    repeat: normalizeRule(d.repeat, date),
    alertOffset: d.alertOffset === null || d.alertOffset === undefined ? null : Math.max(0, Math.min(60 * 24 * 30, Math.round(d.alertOffset))),
  };
}

export function createReminder(draft: Draft): Reminder {
  const d = sanitizeDraft(draft);
  const ts = nowIso();
  return {
    id: uuid(),
    ...d,
    paused: false,
    done: {},
    overrides: {},
    nextFireAt: null,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  };
}

export function draftFromReminder(r: Reminder): Draft {
  return { title: r.title, notes: r.notes, color: r.color, date: r.date, time: r.time, tz: r.tz, repeat: { ...r.repeat }, alertOffset: r.alertOffset };
}

/** Draft pre-filled for a specific occurrence (anchor wall date/time). */
export function draftFromOccurrence(r: Reminder, key: string): Draft {
  const ov = r.overrides?.[key] ?? {};
  return {
    ...draftFromReminder(r),
    title: ov.title ?? r.title,
    notes: ov.notes ?? r.notes,
    color: ov.color ?? r.color,
    date: ov.date ?? key,
    time: ov.time !== undefined ? ov.time : r.time,
  };
}

function touch(r: Reminder): Reminder {
  return { ...r, updatedAt: nowIso() };
}

function pickKeys<T>(obj: Record<string, T>, pred: (k: string) => boolean): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(obj || {})) if (pred(k)) out[k] = obj[k];
  return out;
}

function sameRule(a: Draft['repeat'], b: Draft['repeat']): boolean {
  return JSON.stringify(normalizeRule(a, '2000-01-03')) === JSON.stringify(normalizeRule(b, '2000-01-03'));
}

export interface EditResult {
  upserts: Reminder[];
}

/**
 * Apply an edit made from occurrence `key` of reminder `r`.
 * For non-recurring reminders the scope is ignored.
 */
export function applyEdit(r: Reminder, key: string | null, draftIn: Draft, scope: EditScope): EditResult {
  const draft = sanitizeDraft(draftIn);
  if (!isRecurring(r.repeat) || key === null) {
    const changedDate = draft.date !== r.date || draft.time !== r.time;
    const next: Reminder = touch({
      ...r,
      ...draft,
      // a rescheduled one-time reminder starts fresh
      done: !isRecurring(draft.repeat) && changedDate ? {} : isRecurring(draft.repeat) && !isRecurring(r.repeat) ? {} : r.done,
      overrides: isRecurring(r.repeat) ? r.overrides : {},
    });
    return { upserts: [next] };
  }

  if (scope === 'this') {
    const prev = r.overrides?.[key] ?? {};
    const ov: Override = { ...prev };
    ov.date = draft.date;
    ov.time = draft.time;
    ov.title = draft.title;
    ov.notes = draft.notes;
    ov.color = draft.color;
    // drop no-op fields to keep overrides small
    if (ov.date === key) delete ov.date;
    if (ov.time === r.time) delete ov.time;
    if (ov.title === r.title) delete ov.title;
    if (ov.notes === r.notes) delete ov.notes;
    if (ov.color === r.color) delete ov.color;
    const overrides = { ...r.overrides };
    if (Object.keys(ov).length) overrides[key] = ov;
    else delete overrides[key];
    return { upserts: [touch({ ...r, overrides })] };
  }

  if (scope === 'following' && cmp(key, r.date) > 0) {
    const head = touch({
      ...r,
      repeat: { ...r.repeat, until: addDays(key, -1) },
      done: pickKeys(r.done, (k) => cmp(k, key) < 0),
      overrides: pickKeys(r.overrides, (k) => cmp(k, key) < 0),
    });
    const keepHistory = draft.date === key && sameRule(draft.repeat, r.repeat);
    const tail: Reminder = {
      ...createReminder({ ...draft, repeat: { ...draft.repeat, until: draft.repeat.until ?? r.repeat.until } }),
      paused: r.paused,
      done: keepHistory ? pickKeys(r.done, (k) => cmp(k, key) >= 0) : {},
      overrides: keepHistory ? pickKeys(r.overrides, (k) => cmp(k, key) > 0) : {},
    };
    tail.repeat = normalizeRule(tail.repeat, tail.date);
    return { upserts: [head, tail] };
  }

  // whole series (or "following" from the first occurrence)
  const delta = diffDays(draft.date, key);
  const start = delta ? addDays(r.date, delta) : r.date;
  const ruleChanged = !sameRule(draft.repeat, r.repeat);
  const overrides = delta ? {} : { ...r.overrides };
  delete overrides[key];
  const next = touch({
    ...r,
    title: draft.title,
    notes: draft.notes,
    color: draft.color,
    time: draft.time,
    tz: draft.tz,
    alertOffset: draft.alertOffset,
    date: start,
    repeat: normalizeRule(
      { ...draft.repeat, until: draft.repeat.until && cmp(draft.repeat.until, start) < 0 ? undefined : draft.repeat.until },
      start,
    ),
    done: delta || ruleChanged ? pickKeys(r.done, () => !delta) : r.done,
    overrides,
  });
  return { upserts: [next] };
}

/** Delete with scope. Returns the updated reminder (soft-deleted for 'all'). */
export function applyDelete(r: Reminder, key: string | null, scope: EditScope): Reminder {
  if (!isRecurring(r.repeat) || key === null || scope === 'all' || (scope === 'following' && cmp(key, r.date) <= 0)) {
    return touch({ ...r, deletedAt: nowIso() });
  }
  if (scope === 'this') {
    const overrides = { ...r.overrides, [key]: { ...(r.overrides?.[key] ?? {}), cancelled: true } };
    return touch({ ...r, overrides });
  }
  // following
  const until = addDays(key, -1);
  const rule = { ...r.repeat, until };
  const trimmed = touch({
    ...r,
    repeat: rule,
    done: pickKeys(r.done, (k) => cmp(k, key) < 0),
    overrides: pickKeys(r.overrides, (k) => cmp(k, key) < 0),
  });
  if (!hasDatesFrom(rule, r.date, r.date)) return touch({ ...trimmed, deletedAt: nowIso() });
  return trimmed;
}

export function setDone(r: Reminder, key: string, done: boolean): Reminder {
  const map = { ...r.done };
  if (done) map[key] = nowIso();
  else delete map[key];
  return touch({ ...r, done: map });
}

/** Move one occurrence (or a one-time reminder) to a new date/time. */
export function postpone(r: Reminder, key: string, date: string, time: string | null): Reminder {
  if (!isRecurring(r.repeat)) {
    return touch({ ...r, date, time, tz: time ? r.tz : null, done: {}, overrides: {} });
  }
  const prev = r.overrides?.[key] ?? {};
  const ov: Override = { ...prev, date, time };
  if (ov.date === key) delete ov.date;
  if (ov.time === r.time) delete ov.time;
  const overrides = { ...r.overrides };
  if (Object.keys(ov).length) overrides[key] = ov;
  else delete overrides[key];
  const done = { ...r.done };
  delete done[key];
  return touch({ ...r, overrides, done });
}

export function setPaused(r: Reminder, paused: boolean): Reminder {
  return touch({ ...r, paused });
}

/** Whether "only this occurrence" is a valid scope for the given draft. */
export function canEditOnlyThis(r: Reminder, draft: Draft): boolean {
  return sameRule(draft.repeat, r.repeat) && draft.tz === r.tz && draft.alertOffset === r.alertOffset;
}
