'use client';
import { useMemo, useState } from 'react';
import { addDays, diffDays, fmtLong, fmtRelative, nowTimeIn, weekday, zoneCity, timeToMinutes, minutesToTime } from '../core/dates';
import { colorVars } from '../core/colors';
import { describeRule } from '../core/recurrence';
import { occurrencesInRange } from '../core/occurrences';
import type { ColorKey, EditScope, Occurrence, Reminder } from '../core/types';
import { Sheet } from './Sheet';
import { MonthGrid } from './MonthGrid';
import { ArrowForward, Check, Pause, Pencil, Play, Trash, Undo } from './icons';
import { ALERTS } from './Editor';

/* ---------------- occurrence actions ---------------- */

interface ActionProps {
  occ: Occurrence | null;
  reminder: Reminder | null;
  today: string;
  onClose: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onPostpone: () => void;
  onPause: () => void;
  onDelete: () => void;
}

export function ActionSheet({ occ, reminder, today, onClose, onToggle, onEdit, onPostpone, onPause, onDelete }: ActionProps) {
  const [last, setLast] = useState<{ occ: Occurrence; reminder: Reminder } | null>(null);
  if (occ && reminder && (last?.occ !== occ || last.reminder !== reminder)) setLast({ occ, reminder });
  const o = occ ?? last?.occ;
  const r = reminder ?? last?.reminder;
  const alert = r ? ALERTS.find((a) => a.v === r.alertOffset)?.label : '';
  return (
    <Sheet open={!!occ} onClose={onClose} label="Действия">
      {o && r && (
        <div style={colorVars(o.color) as React.CSSProperties}>
          <div className="occ-head">
            <span className="occ-dot" />
            <div style={{ minWidth: 0 }}>
              <div className="occ-title">{o.title}</div>
              <div className="occ-sub">
                {fmtRelative(o.date, today)}
                {o.time ? `, ${o.time}` : ', весь день'}
                {o.foreignZone && o.anchorTime ? ` (${o.anchorTime} ${zoneCity(o.foreignZone)})` : ''}
                {o.recurring ? ` · ${describeRule(r.repeat, r.date, true)}` : ''}
              </div>
              <div className="occ-sub" style={{ fontSize: 13 }}>
                {r.paused ? 'Уведомления приостановлены' : alert}
                {o.done && o.doneAt ? ` · выполнено ${new Date(o.doneAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
              </div>
            </div>
          </div>
          {o.notes && <div className="occ-notes">{o.notes}</div>}
          <div className="tiles">
            <button className="tile ok" onClick={onToggle}>
              {o.done ? <Undo /> : <Check />}
              {o.done ? 'Вернуть' : 'Выполнено'}
            </button>
            <button className="tile" onClick={onEdit}><Pencil />Изменить</button>
            <button className="tile" onClick={onPostpone}><ArrowForward />Перенести</button>
            <button className="tile" onClick={onPause}>
              {r.paused ? <Play /> : <Pause />}
              {r.paused ? 'Возобновить' : 'Отключить'}
            </button>
          </div>
          <button className="danger-btn" onClick={onDelete}><Trash size={19} />Удалить</button>
        </div>
      )}
    </Sheet>
  );
}

/* ---------------- scope chooser ---------------- */

export interface ScopeRequest {
  kind: 'edit' | 'delete';
  allowThis: boolean;
  onPick: (s: EditScope) => void;
}

export function ScopeSheet({ req, onClose }: { req: ScopeRequest | null; onClose: () => void }) {
  const [last, setLast] = useState<ScopeRequest | null>(null);
  if (req && req !== last) setLast(req);
  const r = req ?? last;
  const del = r?.kind === 'delete';
  return (
    <Sheet open={!!req} onClose={onClose} title={del ? 'Удалить повторяющееся' : 'Изменить повторяющееся'} z={2}>
      {r && (
        <>
          <button className="choice" disabled={!r.allowThis} onClick={() => r.onPick('this')}>
            <b>Только это</b>
            <small>{r.allowThis ? (del ? 'Остальные повторы останутся' : 'Изменится только выбранный день') : 'Недоступно: изменены повтор, пояс или уведомление'}</small>
          </button>
          <button className="choice" onClick={() => r.onPick('following')}>
            <b>Это и все последующие</b>
            <small>{del ? 'Прошлые повторы сохранятся' : 'Прошлые повторы останутся как были'}</small>
          </button>
          <button className="choice" onClick={() => r.onPick('all')}>
            <b style={del ? { color: 'var(--danger)' } : undefined}>Всю серию</b>
            <small>{del ? 'Удалить напоминание полностью' : 'Применить ко всем повторам'}</small>
          </button>
          <button className="secondary-btn" style={{ marginTop: 6 }} onClick={onClose}>Отмена</button>
        </>
      )}
    </Sheet>
  );
}

/* ---------------- postpone ---------------- */

interface PostponeProps {
  occ: Occurrence | null;
  today: string;
  zone: string;
  onClose: () => void;
  onPick: (date: string, time: string | null) => void;
}

export function PostponeSheet({ occ, today, zone, onClose, onPick }: PostponeProps) {
  const [last, setLast] = useState<Occurrence | null>(null);
  if (occ && occ !== last) setLast(occ);
  const o = occ ?? last;
  return (
    <Sheet open={!!occ} onClose={onClose} title="Перенести" z={1}>
      {o && <PostponeBody key={o.uid} o={o} today={today} zone={zone} onPick={onPick} />}
    </Sheet>
  );
}

function PostponeBody({ o, today, zone, onPick }: { o: Occurrence; today: string; zone: string; onPick: PostponeProps['onPick'] }) {
  const [date, setDate] = useState(o.anchorDate);
  const [time, setTime] = useState<string | null>(o.anchorTime);
  const [month, setMonth] = useState(o.anchorDate);
  const nowT = nowTimeIn(zone);
  const nextMon = addDays(today, ((8 - weekday(today)) % 7) || 7);
  const quick: { label: string; date: string; time: string | null }[] = [];
  if (o.anchorTime) {
    const inHour = timeToMinutes(nowT) + 60;
    if (inHour < 24 * 60) quick.push({ label: 'Через час', date: today, time: minutesToTime(Math.ceil(inHour / 5) * 5) });
    if (timeToMinutes(nowT) < 18 * 60) quick.push({ label: 'Сегодня вечером', date: today, time: '19:00' });
  }
  const base = diffDays(o.anchorDate, today) >= 0 ? o.anchorDate : today;
  quick.push({ label: 'Завтра', date: addDays(today, 1), time: o.anchorTime });
  quick.push({ label: '+1 день', date: addDays(base, 1), time: o.anchorTime });
  quick.push({ label: 'Через 3 дня', date: addDays(today, 3), time: o.anchorTime });
  quick.push({ label: 'В понедельник', date: nextMon, time: o.anchorTime });
  quick.push({ label: 'Через неделю', date: addDays(base, 7), time: o.anchorTime });
  const seen = new Set<string>();
  const uniq = quick.filter((q) => {
    const k = q.date + q.time;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return (
    <>
      <div className="chips" style={{ marginBottom: 16 }}>
        {uniq.map((q) => (
          <button key={q.label} className="pchip" style={{ background: 'var(--surface-2)' }} onClick={() => onPick(q.date, q.time)}>
            {q.label}
          </button>
        ))}
      </div>
      <div className="group" style={{ padding: '12px 12px 6px' }}>
        <MonthGrid compact month={month} onMonth={setMonth} selected={date} today={today} onSelect={setDate} />
      </div>
      <div className="group" style={{ marginTop: 12 }}>
        <div className="row static">
          <span className="row-label">{fmtLong(date, today)}</span>
          {time !== null ? (
            <input type="time" className="time-input" value={time} aria-label="Новое время" onChange={(e) => setTime(e.target.value || null)} />
          ) : (
            <button className="text-btn right" onClick={() => setTime('09:00')}>Указать время</button>
          )}
        </div>
      </div>
      <button className="primary-btn" style={{ marginTop: 16 }} onClick={() => onPick(date, time)}>
        Перенести
      </button>
    </>
  );
}

/* ---------------- calendar ---------------- */

interface CalProps {
  open: boolean;
  selected: string;
  today: string;
  zone: string;
  reminders: Reminder[];
  onClose: () => void;
  onPick: (d: string) => void;
}

export function CalendarSheet({ open, selected, today, zone, reminders, onClose, onPick }: CalProps) {
  const [month, setMonth] = useState(selected);
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (open && openedFor !== selected) {
    setOpenedFor(selected);
    setMonth(selected);
  }
  if (!open && openedFor !== null) setOpenedFor(null);

  const dots = useMemo(() => {
    if (!open) return {};
    const from = addDays(month.slice(0, 8) + '01', -7);
    const occ = occurrencesInRange(reminders, from, addDays(from, 50), zone);
    const m: Record<string, ColorKey[]> = {};
    for (const o of occ) {
      if (o.done) continue;
      (m[o.date] ||= []);
      if (!m[o.date].includes(o.color)) m[o.date].push(o.color);
    }
    return m;
  }, [open, month, reminders, zone]);

  return (
    <Sheet open={open} onClose={onClose} label="Календарь">
      <MonthGrid month={month} onMonth={setMonth} selected={selected} today={today} dots={dots} onSelect={onPick} />
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="secondary-btn" onClick={() => setMonth(today)}>Этот месяц</button>
        <button className="primary-btn" style={{ height: 50 }} onClick={() => onPick(today)}>Сегодня</button>
      </div>
    </Sheet>
  );
}
