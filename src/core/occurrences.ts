/**
 * Turns reminder series into concrete occurrences in the viewer's time zone,
 * and computes the next notification instant.
 */
import { addDays, cmp, msToZoned, timeToMinutes, zonedToMs } from './dates';
import { isRecurring, seriesDates } from './recurrence';
import type { Occurrence, Reminder } from './types';

export const DEFAULT_ALLDAY_TIME = '09:00';

function anchorZoneOf(r: Reminder, viewerZone: string): string {
  return r.tz && r.time ? r.tz : viewerZone;
}

interface RawOcc {
  key: string;
  date: string; // anchor wall date
  time: string | null;
}

/** Raw occurrences (anchor wall date) within [from, to], overrides applied. */
function rawInRange(r: Reminder, from: string, to: string): RawOcc[] {
  const out: RawOcc[] = [];
  const overrides = r.overrides || {};
  for (const key of seriesDates(r.repeat, r.date, from, to)) {
    const ov = overrides[key];
    if (ov?.cancelled) continue;
    if (ov && (ov.date !== undefined && ov.date !== key)) continue; // moved elsewhere
    out.push({ key, date: key, time: ov && ov.time !== undefined ? ov.time : r.time });
  }
  for (const key of Object.keys(overrides)) {
    const ov = overrides[key];
    if (ov.cancelled || ov.date === undefined || ov.date === key) continue;
    if (cmp(ov.date, from) >= 0 && cmp(ov.date, to) <= 0) {
      out.push({ key, date: ov.date, time: ov.time !== undefined ? ov.time : r.time });
    }
  }
  return out;
}

function build(r: Reminder, raw: RawOcc, viewerZone: string, now: number): Occurrence {
  const zone = anchorZoneOf(r, viewerZone);
  const ov = r.overrides?.[raw.key];
  let date = raw.date;
  let time = raw.time;
  let at: number;
  const pinnedForeign = !!(r.tz && raw.time && r.tz !== viewerZone);
  if (raw.time) {
    at = zonedToMs(raw.date, raw.time, zone);
    if (pinnedForeign) {
      const v = msToZoned(at, viewerZone);
      date = v.date;
      time = v.time;
    }
  } else {
    at = zonedToMs(raw.date, '00:00', viewerZone);
  }
  void now;
  return {
    uid: `${r.id}|${raw.key}`,
    rid: r.id,
    key: raw.key,
    date,
    time,
    anchorDate: raw.date,
    anchorTime: raw.time,
    anchorZone: zone,
    title: ov?.title ?? r.title,
    notes: ov?.notes ?? r.notes,
    color: ov?.color ?? r.color,
    done: !!r.done?.[raw.key],
    doneAt: r.done?.[raw.key] ?? null,
    paused: r.paused,
    recurring: isRecurring(r.repeat),
    moved: !!(ov && ((ov.date !== undefined && ov.date !== raw.key) || ov.time !== undefined)),
    foreignZone: pinnedForeign ? r.tz : null,
    at,
  };
}

export function sortOccurrences(list: Occurrence[]): Occurrence[] {
  return list.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const ta = a.time === null ? -1 : timeToMinutes(a.time);
    const tb = b.time === null ? -1 : timeToMinutes(b.time);
    if (ta !== tb) return ta - tb;
    return a.title.localeCompare(b.title, 'ru');
  });
}

/** All occurrences whose viewer-zone date is within [from, to]. */
export function occurrencesInRange(
  reminders: Reminder[],
  from: string,
  to: string,
  viewerZone: string,
  now = Date.now(),
): Occurrence[] {
  const out: Occurrence[] = [];
  for (const r of reminders) {
    if (r.deletedAt) continue;
    const foreign = !!(r.tz && r.time && r.tz !== viewerZone);
    // pinned reminders may shift by up to a day when converted
    const f = foreign ? addDays(from, -1) : from;
    const t = foreign ? addDays(to, 1) : to;
    for (const raw of rawInRange(r, f, t)) {
      const o = build(r, raw, viewerZone, now);
      if (cmp(o.date, from) >= 0 && cmp(o.date, to) <= 0) out.push(o);
    }
  }
  return sortOccurrences(out);
}

export function occurrencesOn(reminders: Reminder[], day: string, zone: string): Occurrence[] {
  return occurrencesInRange(reminders, day, day, zone);
}

/** Look up a single occurrence by key. */
export function occurrenceByKey(r: Reminder, key: string, viewerZone: string): Occurrence | null {
  const ov = r.overrides?.[key];
  if (ov?.cancelled) return null;
  const isBase = seriesDates(r.repeat, r.date, key, key).length === 1;
  if (!isBase && !ov) return null;
  const raw: RawOcc = {
    key,
    date: ov?.date ?? key,
    time: ov && ov.time !== undefined ? ov.time : r.time,
  };
  return build(r, raw, viewerZone, Date.now());
}

/** Instant at which an occurrence should notify. */
export function fireAt(r: Reminder, raw: { date: string; time: string | null }, viewerZone: string, allDayTime = DEFAULT_ALLDAY_TIME): number {
  const zone = raw.time ? anchorZoneOf(r, viewerZone) : viewerZone;
  const at = zonedToMs(raw.date, raw.time ?? allDayTime, zone);
  return at - (r.alertOffset ?? 0) * 60000;
}

/**
 * Next notification for the reminder strictly after `afterMs`, skipping
 * completed and cancelled occurrences. Returns null if none / disabled.
 */
export function nextFire(
  r: Reminder,
  afterMs: number,
  viewerZone: string,
  allDayTime = DEFAULT_ALLDAY_TIME,
): { at: number; key: string; date: string; time: string | null } | null {
  if (r.deletedAt || r.paused || r.alertOffset === null || r.alertOffset === undefined) return null;
  const zone = anchorZoneOf(r, viewerZone);
  // start a little before "now" in anchor wall-time; alerts can be up to days early
  const lead = Math.ceil((r.alertOffset ?? 0) / 1440) + 2;
  let from = addDays(msToZoned(afterMs, zone).date, -lead);
  const horizonYears = isRecurring(r.repeat) ? 12 : 0;
  const end = addDays(from, 366 * horizonYears + 400);
  const chunk = r.repeat.freq === 'yearly' ? 1500 : r.repeat.freq === 'monthly' ? 400 : 62;
  while (cmp(from, end) <= 0) {
    const to = addDays(from, chunk - 1);
    const raws = rawInRange(r, from, to).sort((a, b) =>
      a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.time ?? '') < (b.time ?? '') ? -1 : 1,
    );
    let best: { at: number; key: string; date: string; time: string | null } | null = null;
    for (const raw of raws) {
      if (r.done?.[raw.key]) continue;
      const at = fireAt(r, raw, viewerZone, allDayTime);
      if (at > afterMs && (!best || at < best.at)) best = { at, key: raw.key, date: raw.date, time: raw.time };
    }
    if (best) return best;
    if (r.repeat.freq === 'none') {
      // a single reminder may have been moved far away
      const ov = r.overrides?.[r.date];
      if (!ov?.date || cmp(ov.date, to) <= 0) return null;
    } else if (r.repeat.until && cmp(to, r.repeat.until) >= 0) {
      // allow overrides moved past the end
      const moved = Object.values(r.overrides || {}).some((o) => o.date && cmp(o.date, to) > 0);
      if (!moved) return null;
    }
    from = addDays(to, 1);
  }
  return null;
}

/** The next not-done occurrence from `today` (for list displays). */
export function nextOccurrence(r: Reminder, today: string, viewerZone: string): Occurrence | null {
  let from = today;
  for (let i = 0; i < 40; i++) {
    const span = r.repeat.freq === 'yearly' ? 800 : r.repeat.freq === 'monthly' ? 120 : 30;
    const to = addDays(from, span);
    const occ = occurrencesInRange([r], from, to, viewerZone).filter((o) => !o.done);
    if (occ.length) return occ[0];
    if (r.repeat.freq === 'none' && !Object.values(r.overrides || {}).some((o) => o.date && cmp(o.date, to) > 0)) return null;
    if (r.repeat.until && cmp(to, r.repeat.until) >= 0) return null;
    from = addDays(to, 1);
  }
  return null;
}

/** Completed occurrences across all reminders, newest completion first. */
export function completedOccurrences(reminders: Reminder[], viewerZone: string, limit = 300): Occurrence[] {
  const out: Occurrence[] = [];
  for (const r of reminders) {
    if (r.deletedAt) continue;
    for (const key of Object.keys(r.done || {})) {
      const o = occurrenceByKey(r, key, viewerZone);
      if (o) out.push(o);
    }
  }
  out.sort((a, b) => (a.doneAt! < b.doneAt! ? 1 : a.doneAt! > b.doneAt! ? -1 : 0));
  return out.slice(0, limit);
}

/** Recompute `nextFireAt` for the push server. */
export function computeNextFireAt(r: Reminder, viewerZone: string, now = Date.now(), allDayTime = DEFAULT_ALLDAY_TIME): string | null {
  const n = nextFire(r, now, viewerZone, allDayTime);
  return n ? new Date(n.at).toISOString() : null;
}
