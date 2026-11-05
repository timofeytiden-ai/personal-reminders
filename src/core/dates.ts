/**
 * Date & time-zone helpers built on the platform Intl API (no dependencies).
 *
 * Calendar math is done on plain "YYYY-MM-DD" strings via UTC epoch days,
 * so it is never affected by DST. Conversions between a wall-clock time in a
 * zone and an absolute instant use Intl.DateTimeFormat with `timeZone`.
 */

const DAY = 86_400_000;

export function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/* ---------------- pure calendar math ---------------- */

export function parseDate(d: string): { y: number; m: number; d: number } {
  const [y, m, dd] = d.split('-').map(Number);
  return { y, m, d: dd };
}

export function toDays(d: string): number {
  const p = parseDate(d);
  return Math.floor(Date.UTC(p.y, p.m - 1, p.d) / DAY);
}

export function fromDays(n: number): string {
  const dt = new Date(n * DAY);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addDays(d: string, n: number): string {
  return fromDays(toDays(d) + n);
}

export function diffDays(a: string, b: string): number {
  return toDays(a) - toDays(b);
}

/** ISO weekday: 1 = Monday … 7 = Sunday */
export function weekday(d: string): number {
  const w = new Date(toDays(d) * DAY).getUTCDay();
  return w === 0 ? 7 : w;
}

export function startOfWeek(d: string): string {
  return addDays(d, 1 - weekday(d));
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Add months, clamping the day to the month's length (Jan 31 + 1 → Feb 28/29). */
export function addMonths(d: string, n: number, dayOfMonth?: number): string {
  const p = parseDate(d);
  const total = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const day = Math.min(dayOfMonth ?? p.d, daysInMonth(y, m));
  return `${y}-${pad(m)}-${pad(day)}`;
}

export function monthsBetween(a: string, b: string): number {
  const pa = parseDate(a);
  const pb = parseDate(b);
  return (pa.y - pb.y) * 12 + (pa.m - pb.m);
}

export function startOfMonth(d: string): string {
  return d.slice(0, 8) + '01';
}

export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

export function isValidDate(d: unknown): d is string {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const p = parseDate(d);
  return p.m >= 1 && p.m <= 12 && p.d >= 1 && p.d <= daysInMonth(p.y, p.m);
}

export function isValidTime(t: unknown): t is string {
  return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/* ---------------- time zones ---------------- */

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(zone, f);
  }
  return f;
}

export function isValidZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !zone) return false;
  try {
    partsFormatter(zone);
    return true;
  } catch {
    return false;
  }
}

export function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Wall-clock components of an instant in a zone. */
export function wallParts(ms: number, zone: string) {
  const parts = partsFormatter(zone).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  let hour = get('hour');
  if (hour === 24) hour = 0;
  return { y: get('year'), m: get('month'), d: get('day'), h: hour, min: get('minute'), s: get('second') };
}

/** Offset of zone from UTC at an instant, in minutes (Athens summer → +180). */
export function zoneOffset(ms: number, zone: string): number {
  const p = wallParts(ms, zone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/**
 * Absolute instant for a wall-clock date/time in a zone.
 * Non-existent times (spring-forward gap) are shifted forward by the gap,
 * ambiguous times (fall-back) resolve to the earlier instant.
 */
export function zonedToMs(date: string, time: string, zone: string): number {
  const p = parseDate(date);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(p.y, p.m - 1, p.d, h, mi);
  const o1 = zoneOffset(wall, zone);
  let t = wall - o1 * 60000;
  const o2 = zoneOffset(t, zone);
  if (o2 !== o1) {
    const t2 = wall - o2 * 60000;
    // pick the candidate that maps back to the requested wall time, else the later (gap)
    const back = msToZoned(t2, zone);
    t = back.date === date && back.time === time ? t2 : Math.max(t, t2);
  }
  // fall-back ambiguity: prefer the earlier instant if it also maps to the same wall time
  const earlier = t - 3600_000;
  const e = msToZoned(earlier, zone);
  if (e.date === date && e.time === time) t = earlier;
  return t;
}

export function msToZoned(ms: number, zone: string): { date: string; time: string } {
  const p = wallParts(ms, zone);
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.min)}` };
}

export function todayIn(zone: string, now = Date.now()): string {
  return msToZoned(now, zone).date;
}

export function nowTimeIn(zone: string, now = Date.now()): string {
  return msToZoned(now, zone).time;
}

/** "GMT+3", "GMT-4:30" */
export function offsetLabel(zone: string, ms = Date.now()): string {
  const o = zoneOffset(ms, zone);
  if (o === 0) return 'GMT';
  const sign = o > 0 ? '+' : '−';
  const a = Math.abs(o);
  return `GMT${sign}${Math.floor(a / 60)}${a % 60 ? ':' + pad(a % 60) : ''}`;
}

export function allZones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (fn) {
      const list = fn('timeZone');
      if (!list.includes('UTC')) list.push('UTC');
      return list;
    }
  } catch {
    /* ignore */
  }
  return [
    'UTC', 'Europe/London', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome', 'Europe/Madrid',
    'Europe/Athens', 'Europe/Bucharest', 'Europe/Kyiv', 'Europe/Istanbul', 'Europe/Moscow', 'Asia/Dubai',
    'Asia/Tbilisi', 'Asia/Yerevan', 'Asia/Almaty', 'Asia/Tashkent', 'Asia/Kolkata', 'Asia/Bangkok',
    'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'America/New_York',
    'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo', 'Pacific/Auckland',
  ];
}

/** "Europe/Athens" → "Athens" */
export function zoneCity(zone: string): string {
  const s = zone.split('/').pop() || zone;
  return s.replace(/_/g, ' ');
}

/* ---------------- Russian formatting ---------------- */

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WD_LONG = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const WD_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export const RU = { MONTHS_GEN, MONTHS_NOM, WD_LONG, WD_SHORT };

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "5 ноября" (+ year if different from `today`) */
export function fmtDayMonth(d: string, today?: string): string {
  const p = parseDate(d);
  const base = `${p.d} ${MONTHS_GEN[p.m - 1]}`;
  if (today && today.slice(0, 4) !== d.slice(0, 4)) return `${base} ${p.y}`;
  return base;
}

/** "Четверг, 5 ноября" */
export function fmtLong(d: string, today?: string): string {
  return `${cap(WD_LONG[weekday(d) - 1])}, ${fmtDayMonth(d, today)}`;
}

/** "Сегодня" / "Завтра" / "Вчера" / "Пт, 7 ноября" */
export function fmtRelative(d: string, today: string): string {
  const diff = diffDays(d, today);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Завтра';
  if (diff === -1) return 'Вчера';
  if (diff === 2) return 'Послезавтра';
  return `${WD_SHORT[weekday(d) - 1]}, ${fmtDayMonth(d, today)}`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
