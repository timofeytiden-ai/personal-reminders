/**
 * Core domain types.
 *
 * Dates are stored as wall-clock strings: "YYYY-MM-DD" and "HH:mm".
 * A reminder with `tz = null` is "floating": 09:00 means 09:00 in whatever
 * time zone the user is currently in. A reminder with `tz = "Europe/Athens"`
 * is pinned: 09:00 Athens, shown converted to the user's current zone.
 */

export type ColorKey = 'sky' | 'lavender' | 'mint' | 'green' | 'peach' | 'yellow' | 'pink';

export type Freq = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RepeatRule {
  freq: Freq;
  /** every N units (>= 1) */
  interval: number;
  /** ISO weekdays 1 (Mon) … 7 (Sun); weekly only */
  byWeekday?: number[];
  /** inclusive last date of the series, YYYY-MM-DD; undefined = forever */
  until?: string;
}

export interface Override {
  /** moved wall date (anchor zone) */
  date?: string;
  /** moved wall time; null = all-day */
  time?: string | null;
  title?: string;
  notes?: string;
  color?: ColorKey;
  /** occurrence deleted from the series */
  cancelled?: boolean;
}

export interface Reminder {
  id: string;
  title: string;
  notes: string;
  color: ColorKey;
  /** first occurrence date (anchor zone) */
  date: string;
  /** HH:mm or null for all-day */
  time: string | null;
  /** IANA zone the time is pinned to; null = floating (user's current zone) */
  tz: string | null;
  repeat: RepeatRule;
  /** minutes before the event to notify; null = no notification */
  alertOffset: number | null;
  paused: boolean;
  /** completed occurrences: key (original date) -> ISO timestamp of completion */
  done: Record<string, string>;
  /** per-occurrence changes, keyed by original date */
  overrides: Record<string, Override>;
  /** next notification instant (UTC ISO), used by the push server */
  nextFireAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** One concrete appearance of a reminder on a given day (in the viewer's zone). */
export interface Occurrence {
  uid: string; // `${rid}|${key}`
  rid: string;
  key: string;
  /** date/time in the viewer's zone */
  date: string;
  time: string | null;
  /** wall date/time in the anchor zone */
  anchorDate: string;
  anchorTime: string | null;
  anchorZone: string;
  title: string;
  notes: string;
  color: ColorKey;
  done: boolean;
  doneAt: string | null;
  paused: boolean;
  recurring: boolean;
  moved: boolean;
  /** pinned to a zone different from the viewer's */
  foreignZone: string | null;
  /** epoch ms of the event (for sorting / notifications) */
  at: number;
}

export interface Settings {
  name: string;
  greetings: { morning: string; day: string; evening: string };
  tzMode: 'auto' | 'manual';
  tzManual: string;
  theme: 'system' | 'light' | 'dark';
  notifications: boolean;
  sound: boolean;
  /** default alert offset for new reminders */
  defaultAlert: number | null;
  /** time used to notify about all-day reminders */
  allDayAlertTime: string;
  updatedAt: string;
}

/** Fields edited in the reminder editor. */
export interface Draft {
  title: string;
  notes: string;
  color: ColorKey;
  date: string;
  time: string | null;
  tz: string | null;
  repeat: RepeatRule;
  alertOffset: number | null;
}

export type EditScope = 'this' | 'following' | 'all';
