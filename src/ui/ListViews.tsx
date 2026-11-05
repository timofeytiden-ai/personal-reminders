'use client';
import { useMemo, useState } from 'react';
import { addDays, cmp, diffDays, fmtRelative, msToZoned, plural } from '../core/dates';
import { colorVars } from '../core/colors';
import { describeRule } from '../core/recurrence';
import { completedOccurrences, nextOccurrence, occurrencesInRange } from '../core/occurrences';
import type { Occurrence, Reminder } from '../core/types';
import { ReminderCard } from './ReminderCard';
import { Bell, Calendar, CheckCircle, Pause, Repeat, Search } from './icons';

interface Common {
  reminders: Reminder[];
  byId: Record<string, Reminder>;
  today: string;
  zone: string;
  onToggle: (o: Occurrence) => void;
  onOpen: (o: Occurrence) => void;
}

function groupByDate(list: Occurrence[], key: (o: Occurrence) => string = (o) => o.date) {
  const groups: { date: string; items: Occurrence[] }[] = [];
  for (const o of list) {
    const d = key(o);
    const g = groups[groups.length - 1];
    if (g && g.date === d) g.items.push(o);
    else groups.push({ date: d, items: [o] });
  }
  return groups;
}

/* ---------------- upcoming ---------------- */

export function UpcomingView(p: Common) {
  const [days, setDays] = useState(30);
  const list = useMemo(
    () => occurrencesInRange(p.reminders, p.today, addDays(p.today, days - 1), p.zone).filter((o) => !o.done),
    [p.reminders, p.today, p.zone, days],
  );
  const groups = groupByDate(list);
  return (
    <div>
      <h1 className="view-title">Предстоящие</h1>
      <p className="view-sub">
        {list.length
          ? `${list.length} ${plural(list.length, 'напоминание', 'напоминания', 'напоминаний')} на ${days} ${plural(days, 'день', 'дня', 'дней')}`
          : `Ближайшие ${days} дней свободны`}
      </p>
      {groups.map((g) => (
        <section key={g.date}>
          <div className="section-label">{fmtRelative(g.date, p.today)}</div>
          <div className="cards">
            {g.items.map((o) => (
              <ReminderCard key={o.uid} occ={o} reminder={p.byId[o.rid]} onToggle={p.onToggle} onOpen={p.onOpen} />
            ))}
          </div>
        </section>
      ))}
      {!list.length && <EmptyNote icon={<Calendar size={26} />} text="Нажмите «+», чтобы запланировать что-нибудь." />}
      <button className="btn-soft more-btn" onClick={() => setDays(days + 30)}>Показать ещё 30 дней</button>
    </div>
  );
}

/* ---------------- all ---------------- */

type Filter = 'all' | 'repeat' | 'once' | 'paused' | 'past';

export function AllView(p: Common & { onOpenSeries: (r: Reminder, next: Occurrence | null) => void }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    return p.reminders
      .filter((r) => !query || r.title.toLowerCase().includes(query) || r.notes.toLowerCase().includes(query))
      .map((r) => ({ r, next: nextOccurrence(r, p.today, p.zone) }))
      .filter(({ r, next }) => {
        if (filter === 'repeat') return r.repeat.freq !== 'none';
        if (filter === 'once') return r.repeat.freq === 'none';
        if (filter === 'paused') return r.paused;
        if (filter === 'past') return !next;
        return true;
      })
      .sort((a, b) => {
        if (!!a.next !== !!b.next) return a.next ? -1 : 1;
        if (a.next && b.next) return a.next.at - b.next.at;
        return cmp(b.r.date, a.r.date);
      });
  }, [p.reminders, p.today, p.zone, q, filter]);

  const FILTERS: { k: Filter; label: string }[] = [
    { k: 'all', label: 'Все' },
    { k: 'repeat', label: 'Повторяющиеся' },
    { k: 'once', label: 'Разовые' },
    { k: 'paused', label: 'На паузе' },
    { k: 'past', label: 'Завершённые' },
  ];

  return (
    <div>
      <h1 className="view-title">Все напоминания</h1>
      <p className="view-sub">{p.reminders.length} {plural(p.reminders.length, 'напоминание', 'напоминания', 'напоминаний')}</p>
      <label className="search">
        <Search size={19} />
        <input placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} type="search" enterKeyHint="search" />
      </label>
      <div className="filters">
        {FILTERS.map((f) => (
          <button key={f.k} className={`pchip ${filter === f.k ? 'on' : ''}`} onClick={() => setFilter(f.k)}>{f.label}</button>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        {rows.map(({ r, next }) => (
          <button
            key={r.id}
            className={`srow ${!next || r.paused ? 'dim' : ''}`}
            style={colorVars(r.color) as React.CSSProperties}
            onClick={() => p.onOpenSeries(r, next)}
          >
            <span className="sicon">{r.paused ? <Pause /> : r.repeat.freq !== 'none' ? <Repeat /> : <Bell />}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <div className="srow-title">{r.title}</div>
              <div className="srow-sub">
                {r.repeat.freq !== 'none' ? `${describeRule(r.repeat, r.date, true)} · ` : ''}
                {next
                  ? `${r.repeat.freq !== 'none' ? 'далее ' : ''}${diffDays(next.date, p.today) === 0 ? 'сегодня' : fmtRelative(next.date, p.today).toLowerCase()}${next.time ? ', ' + next.time : ', весь день'}`
                  : `завершено · ${fmtRelative(r.date, p.today).toLowerCase()}`}
              </div>
            </span>
          </button>
        ))}
        {!rows.length && <EmptyNote icon={<Search size={26} />} text={q ? 'Ничего не найдено' : 'Здесь появятся ваши напоминания'} />}
      </div>
    </div>
  );
}

/* ---------------- done ---------------- */

export function DoneView(p: Common) {
  const list = useMemo(() => completedOccurrences(p.reminders, p.zone), [p.reminders, p.zone]);
  const groups = groupByDate(list, (o) => msToZoned(new Date(o.doneAt!).getTime(), p.zone).date);
  return (
    <div>
      <h1 className="view-title">Выполненные</h1>
      <p className="view-sub">
        {list.length ? `Отмечено: ${list.length}` : 'Пока ничего не отмечено'}
      </p>
      {groups.map((g) => (
        <section key={g.date}>
          <div className="section-label">{fmtRelative(g.date, p.today)}</div>
          <div className="cards">
            {g.items.map((o) => (
              <ReminderCard
                key={o.uid}
                occ={o}
                reminder={p.byId[o.rid]}
                onToggle={p.onToggle}
                onOpen={p.onOpen}
                showDate={`${fmtRelative(o.date, p.today)}${o.time ? ', ' + o.time : ''}`}
              />
            ))}
          </div>
        </section>
      ))}
      {!list.length && <EmptyNote icon={<CheckCircle size={26} />} text="Отмечайте кружок слева от напоминания — оно появится здесь." />}
    </div>
  );
}

function EmptyNote({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="empty" style={{ paddingTop: 30 }}>
      <div style={{ width: 56, height: 56, borderRadius: 18, background: 'var(--surface)', display: 'grid', placeItems: 'center', margin: '0 auto 12px', color: 'var(--text-3)', boxShadow: 'var(--shadow)' }}>
        {icon}
      </div>
      <p>{text}</p>
    </div>
  );
}

