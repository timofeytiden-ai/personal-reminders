/**
 * Recurrence engine.
 *
 * Generates the original ("key") dates of a series that fall inside a date
 * range, without iterating from the series start, so it stays fast for
 * long-running daily series. Overrides (moved/cancelled occurrences) are
 * applied in occurrences.ts.
 */
import {
  addDays, addMonths, cmp, diffDays, monthsBetween, parseDate, startOfWeek, weekday, RU, plural, fmtDayMonth,
} from './dates';
import type { RepeatRule } from './types';

export const NO_REPEAT: RepeatRule = { freq: 'none', interval: 1 };

export function normalizeRule(rule: Partial<RepeatRule> | undefined, start: string): RepeatRule {
  const freq = rule?.freq ?? 'none';
  if (freq === 'none') return { freq: 'none', interval: 1 };
  const interval = Math.max(1, Math.min(999, Math.floor(Number(rule?.interval) || 1)));
  const out: RepeatRule = { freq, interval };
  if (freq === 'weekly') {
    const days = Array.from(new Set((rule?.byWeekday ?? []).map(Number).filter((d) => d >= 1 && d <= 7))).sort();
    out.byWeekday = days.length ? days : [weekday(start)];
  }
  if (rule?.until && cmp(rule.until, start) >= 0) out.until = rule.until;
  return out;
}

export function isRecurring(rule: RepeatRule): boolean {
  return rule.freq !== 'none';
}

/** Original dates of the series within [from, to] (inclusive), sorted. */
export function seriesDates(rule: RepeatRule, start: string, from: string, to: string): string[] {
  if (rule.until && cmp(rule.until, to) < 0) to = rule.until;
  if (cmp(from, start) < 0) from = start;
  if (cmp(from, to) > 0) return [];
  const out: string[] = [];
  const n = Math.max(1, rule.interval || 1);

  switch (rule.freq) {
    case 'none':
      if (cmp(start, from) >= 0 && cmp(start, to) <= 0) out.push(start);
      break;

    case 'daily': {
      const off = diffDays(from, start);
      let k = Math.ceil(off / n);
      for (let d = addDays(start, k * n); cmp(d, to) <= 0; k++, d = addDays(start, k * n)) out.push(d);
      break;
    }

    case 'weekly': {
      const days = rule.byWeekday?.length ? [...rule.byWeekday].sort() : [weekday(start)];
      const w0 = startOfWeek(start);
      const wFrom = startOfWeek(from);
      let wi = Math.floor(diffDays(wFrom, w0) / 7);
      wi = Math.floor(wi / n) * n; // first eligible week at/before `from`
      for (; ; wi += n) {
        const ws = addDays(w0, wi * 7);
        if (cmp(ws, to) > 0) break;
        for (const wd of days) {
          const d = addDays(ws, wd - 1);
          if (cmp(d, start) >= 0 && cmp(d, from) >= 0 && cmp(d, to) <= 0) out.push(d);
        }
      }
      break;
    }

    case 'monthly':
    case 'yearly': {
      const step = rule.freq === 'monthly' ? n : n * 12;
      const dom = parseDate(start).d;
      let k = Math.max(0, Math.floor(monthsBetween(from, start) / step) - 1);
      for (let guard = 0; guard < 2000; guard++, k++) {
        const d = addMonths(start, k * step, dom);
        if (cmp(d, to) > 0) break;
        if (cmp(d, from) >= 0) out.push(d);
      }
      break;
    }
  }
  return out;
}

/** Is `date` an original occurrence date of the series? */
export function isSeriesDate(rule: RepeatRule, start: string, date: string): boolean {
  return seriesDates(rule, start, date, date).length === 1;
}

/** Does the series have at least one original date on/after `from`? */
export function hasDatesFrom(rule: RepeatRule, start: string, from: string): boolean {
  if (rule.freq === 'none') return cmp(start, from) >= 0;
  if (!rule.until) return true;
  const span = (rule.freq === 'yearly' ? 366 : rule.freq === 'monthly' ? 31 : rule.freq === 'weekly' ? 7 : 1) * rule.interval + 7;
  return seriesDates(rule, start, from, addDays(from, span)).length > 0;
}

/* ---------------- UI presets ---------------- */

export type RepeatPreset = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'weekdays' | 'custom';

export function presetOf(rule: RepeatRule, start: string): RepeatPreset {
  if (rule.freq === 'none') return 'none';
  if (rule.interval !== 1) return 'custom';
  if (rule.freq === 'weekly') {
    const d = rule.byWeekday ?? [];
    return d.length === 1 && d[0] === weekday(start) ? 'weekly' : 'weekdays';
  }
  return rule.freq;
}

export function ruleFromPreset(p: RepeatPreset, start: string, prev?: RepeatRule): RepeatRule {
  const until = prev?.until;
  switch (p) {
    case 'none': return { freq: 'none', interval: 1 };
    case 'daily': return { freq: 'daily', interval: 1, until };
    case 'weekly': return { freq: 'weekly', interval: 1, byWeekday: [weekday(start)], until };
    case 'monthly': return { freq: 'monthly', interval: 1, until };
    case 'yearly': return { freq: 'yearly', interval: 1, until };
    case 'weekdays': {
      const days = prev?.freq === 'weekly' && prev.byWeekday?.length ? prev.byWeekday : [1, 3, 5];
      return { freq: 'weekly', interval: 1, byWeekday: days, until };
    }
    case 'custom': {
      const base = prev && prev.freq !== 'none' ? prev : { freq: 'daily' as const, interval: 2 };
      return { ...base, interval: Math.max(2, base.interval), until };
    }
  }
}

const UNIT_FORMS: Record<string, [string, string, string]> = {
  daily: ['день', 'дня', 'дней'],
  weekly: ['неделю', 'недели', 'недель'],
  monthly: ['месяц', 'месяца', 'месяцев'],
  yearly: ['год', 'года', 'лет'],
};

export function unitWord(freq: string, n: number): string {
  const f = UNIT_FORMS[freq];
  return f ? plural(n, f[0], f[1], f[2]) : '';
}

function weekdayList(days: number[]): string {
  const sorted = [...days].sort();
  if (sorted.join() === '1,2,3,4,5') return 'по будням';
  if (sorted.join() === '6,7') return 'по выходным';
  if (sorted.length === 7) return 'каждый день';
  return sorted.map((d) => RU.WD_SHORT[d - 1]).join(', ');
}

/** Short human description: "Каждый день", "Пн, Ср, Пт", "Каждые 2 недели". */
export function describeRule(rule: RepeatRule, start: string, withUntil = false): string {
  let s: string;
  if (rule.freq === 'none') return 'Не повторять';
  const n = rule.interval;
  if (rule.freq === 'weekly') {
    const days = rule.byWeekday ?? [weekday(start)];
    const single = days.length === 1 && days[0] === weekday(start);
    if (n === 1) s = single ? 'Каждую неделю' : cap1(weekdayList(days));
    else s = `${n % 10 === 1 && n % 100 !== 11 ? 'Каждую' : 'Каждые'} ${n} ${unitWord('weekly', n)}` + (single ? '' : `: ${weekdayList(days)}`);
  } else if (n === 1) {
    s = { daily: 'Каждый день', monthly: 'Каждый месяц', yearly: 'Каждый год' }[rule.freq] ?? '';
  } else {
    const every = n % 10 === 1 && n % 100 !== 11 ? 'Каждый' : 'Каждые';
    s = `${every} ${n} ${unitWord(rule.freq, n)}`;
  }
  if (withUntil && rule.until) s += ` · до ${fmtDayMonth(rule.until)}`;
  return s;
}

function cap1(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
