/* Run: npx tsx --test tests/core.test.ts */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, msToZoned, weekday, zonedToMs, zoneOffset } from '../src/core/dates';
import { describeRule, normalizeRule, seriesDates } from '../src/core/recurrence';
import { completedOccurrences, nextFire, occurrencesInRange, nextOccurrence } from '../src/core/occurrences';
import { applyDelete, applyEdit, createReminder, draftFromOccurrence, postpone, setDone } from '../src/core/mutations';
import type { Draft } from '../src/core/types';

const base = (p: Partial<Draft> = {}): Draft => ({
  title: 'Test', notes: '', color: 'sky', date: '2026-11-05', time: '09:00', tz: null,
  repeat: { freq: 'none', interval: 1 }, alertOffset: 0, ...p,
});

test('calendar math', () => {
  assert.equal(weekday('2026-11-05'), 4); // Thursday
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
});

test('time zones and DST', () => {
  // Athens: UTC+3 in summer, UTC+2 in winter
  assert.equal(zoneOffset(Date.UTC(2026, 6, 1), 'Europe/Athens'), 180);
  assert.equal(zoneOffset(Date.UTC(2026, 11, 1), 'Europe/Athens'), 120);
  const summer = zonedToMs('2026-07-01', '09:00', 'Europe/Athens');
  assert.equal(new Date(summer).toISOString(), '2026-07-01T06:00:00.000Z');
  const winter = zonedToMs('2026-12-01', '09:00', 'Europe/Athens');
  assert.equal(new Date(winter).toISOString(), '2026-12-01T07:00:00.000Z');
  // spring-forward gap 2026-03-29 03:30 Athens doesn't exist → shifted to 04:30
  const gap = zonedToMs('2026-03-29', '03:30', 'Europe/Athens');
  assert.equal(msToZoned(gap, 'Europe/Athens').time, '04:30');
  // fall-back ambiguity 2026-10-25 03:30 Athens → earlier (still +3)
  const amb = zonedToMs('2026-10-25', '03:30', 'Europe/Athens');
  assert.equal(new Date(amb).toISOString(), '2026-10-25T00:30:00.000Z');
  assert.equal(msToZoned(Date.UTC(2026, 10, 5, 23, 30), 'Asia/Tokyo').date, '2026-11-06');
});

test('daily / interval', () => {
  const r = normalizeRule({ freq: 'daily', interval: 3 }, '2026-11-01');
  assert.deepEqual(seriesDates(r, '2026-11-01', '2026-11-05', '2026-11-12'), ['2026-11-07', '2026-11-10']);
});

test('weekly with weekdays and interval', () => {
  const r = normalizeRule({ freq: 'weekly', interval: 1, byWeekday: [1, 3, 5] }, '2026-11-05');
  assert.deepEqual(seriesDates(r, '2026-11-05', '2026-11-01', '2026-11-11'), ['2026-11-06', '2026-11-09', '2026-11-11']);
  const r2 = normalizeRule({ freq: 'weekly', interval: 2 }, '2026-11-05');
  assert.deepEqual(seriesDates(r2, '2026-11-05', '2026-11-01', '2026-12-05'), ['2026-11-05', '2026-11-19', '2026-12-03']);
});

test('monthly clamps, yearly leap day, until', () => {
  const m = normalizeRule({ freq: 'monthly', interval: 1 }, '2026-01-31');
  assert.deepEqual(seriesDates(m, '2026-01-31', '2026-01-01', '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  const y = normalizeRule({ freq: 'yearly', interval: 1 }, '2024-02-29');
  assert.deepEqual(seriesDates(y, '2024-02-29', '2025-01-01', '2028-12-31'), ['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  const u = normalizeRule({ freq: 'daily', interval: 1, until: '2026-11-07' }, '2026-11-05');
  assert.deepEqual(seriesDates(u, '2026-11-05', '2026-11-01', '2026-11-30'), ['2026-11-05', '2026-11-06', '2026-11-07']);
  const m2 = normalizeRule({ freq: 'monthly', interval: 2 }, '2026-01-15');
  assert.deepEqual(seriesDates(m2, '2026-01-15', '2026-06-01', '2026-12-31'), ['2026-07-15', '2026-09-15', '2026-11-15']);
});

test('describe', () => {
  assert.equal(describeRule({ freq: 'weekly', interval: 1, byWeekday: [1, 3, 5] }, '2026-11-05'), 'Пн, Ср, Пт');
  assert.equal(describeRule({ freq: 'weekly', interval: 3, byWeekday: [4] }, '2026-11-05'), 'Каждые 3 недели');
  assert.equal(describeRule({ freq: 'daily', interval: 1 }, '2026-11-05'), 'Каждый день');
  assert.equal(describeRule({ freq: 'monthly', interval: 2 }, '2026-11-05'), 'Каждые 2 месяца');
});

test('floating vs pinned reminders', () => {
  const floating = createReminder(base({ time: '09:00' }));
  const pinned = createReminder(base({ time: '09:00', tz: 'Europe/Athens' }));
  // viewer in New York (UTC-5 in November)
  const occ = occurrencesInRange([floating, pinned], '2026-11-05', '2026-11-05', 'America/New_York');
  const f = occ.find((o) => o.rid === floating.id)!;
  const p = occ.find((o) => o.rid === pinned.id)!;
  assert.equal(f.time, '09:00');
  assert.equal(p.time, '02:00'); // 09:00 Athens (UTC+2) = 07:00 UTC = 02:00 NY
  assert.equal(p.foreignZone, 'Europe/Athens');
  // pinned to a far zone shifts the day
  const tokyo = createReminder(base({ time: '07:00', tz: 'Asia/Tokyo' }));
  const o2 = occurrencesInRange([tokyo], '2026-11-04', '2026-11-05', 'Europe/Athens');
  assert.equal(o2.length, 1);
  assert.equal(o2[0].date, '2026-11-05');
  assert.equal(o2[0].time, '00:00');
});

test('complete one occurrence of a series only', () => {
  let r = createReminder(base({ repeat: { freq: 'daily', interval: 1 } }));
  r = setDone(r, '2026-11-06', true);
  const occ = occurrencesInRange([r], '2026-11-05', '2026-11-07', 'Europe/Athens');
  assert.deepEqual(occ.map((o) => o.done), [false, true, false]);
  assert.equal(completedOccurrences([r], 'Europe/Athens').length, 1);
});

test('next fire skips done, respects alert offset and DST', () => {
  let r = createReminder(base({ date: '2026-10-24', repeat: { freq: 'daily', interval: 1 }, alertOffset: 15 }));
  const now = Date.UTC(2026, 9, 24, 3, 0); // 06:00 Athens
  let n = nextFire(r, now, 'Europe/Athens')!;
  assert.equal(new Date(n.at).toISOString(), '2026-10-24T05:45:00.000Z'); // 08:45 Athens (UTC+3)
  r = setDone(r, '2026-10-24', true);
  n = nextFire(r, now, 'Europe/Athens')!;
  assert.equal(n.key, '2026-10-25');
  r = setDone(r, '2026-10-25', true);
  n = nextFire(r, now, 'Europe/Athens')!;
  assert.equal(new Date(n.at).toISOString(), '2026-10-26T06:45:00.000Z'); // after DST: UTC+2
  const paused = { ...r, paused: true };
  assert.equal(nextFire(paused, now, 'Europe/Athens'), null);
  const once = createReminder(base({ date: '2026-11-01' }));
  assert.equal(nextFire(once, Date.UTC(2026, 10, 5), 'Europe/Athens'), null);
});

test('edit only this occurrence', () => {
  const r = createReminder(base({ repeat: { freq: 'daily', interval: 1 } }));
  const d = { ...draftFromOccurrence(r, '2026-11-07'), title: 'Changed', time: '11:00' };
  const { upserts } = applyEdit(r, '2026-11-07', d, 'this');
  assert.equal(upserts.length, 1);
  const occ = occurrencesInRange(upserts, '2026-11-06', '2026-11-08', 'Europe/Athens');
  assert.deepEqual(occ.map((o) => `${o.title}@${o.time}`), ['Test@09:00', 'Changed@11:00', 'Test@09:00']);
});

test('edit this and following splits the series', () => {
  let r = createReminder(base({ repeat: { freq: 'daily', interval: 1 } }));
  r = setDone(r, '2026-11-05', true);
  r = setDone(r, '2026-11-09', true);
  const d = { ...draftFromOccurrence(r, '2026-11-08'), title: 'New' };
  const { upserts } = applyEdit(r, '2026-11-08', d, 'following');
  assert.equal(upserts.length, 2);
  const [head, tail] = upserts;
  assert.equal(head.repeat.until, '2026-11-07');
  assert.equal(tail.date, '2026-11-08');
  assert.ok(tail.done['2026-11-09']);
  assert.ok(!tail.done['2026-11-05']);
  const occ = occurrencesInRange(upserts, '2026-11-06', '2026-11-09', 'Europe/Athens');
  assert.deepEqual(occ.map((o) => o.title), ['Test', 'Test', 'New', 'New']);
});

test('edit whole series with date shift', () => {
  const r = createReminder(base({ repeat: { freq: 'daily', interval: 2 } })); // 5,7,9...
  const d = { ...draftFromOccurrence(r, '2026-11-09'), date: '2026-11-10', title: 'All' };
  const { upserts } = applyEdit(r, '2026-11-09', d, 'all');
  assert.equal(upserts[0].date, '2026-11-06');
  const occ = occurrencesInRange(upserts, '2026-11-05', '2026-11-10', 'Europe/Athens');
  assert.deepEqual(occ.map((o) => o.date), ['2026-11-06', '2026-11-08', '2026-11-10']);
});

test('delete scopes', () => {
  const r = createReminder(base({ repeat: { freq: 'daily', interval: 1 } }));
  const one = applyDelete(r, '2026-11-06', 'this');
  assert.deepEqual(occurrencesInRange([one], '2026-11-05', '2026-11-07', 'UTC').map((o) => o.date), ['2026-11-05', '2026-11-07']);
  const fol = applyDelete(r, '2026-11-06', 'following');
  assert.deepEqual(occurrencesInRange([fol], '2026-11-05', '2026-11-07', 'UTC').map((o) => o.date), ['2026-11-05']);
  assert.ok(applyDelete(r, '2026-11-05', 'following').deletedAt);
  assert.ok(applyDelete(r, '2026-11-06', 'all').deletedAt);
});

test('postpone occurrence and one-time', () => {
  const r = createReminder(base({ repeat: { freq: 'weekly', interval: 1 } }));
  const p = postpone(r, '2026-11-12', '2026-11-14', '18:00');
  const occ = occurrencesInRange([p], '2026-11-10', '2026-11-20', 'UTC');
  assert.deepEqual(occ.map((o) => `${o.date} ${o.time}`), ['2026-11-14 18:00', '2026-11-19 09:00']);
  const once = postpone(createReminder(base()), '2026-11-05', '2026-11-20', null);
  assert.equal(once.date, '2026-11-20');
  assert.equal(nextOccurrence(once, '2026-11-05', 'UTC')!.date, '2026-11-20');
});
