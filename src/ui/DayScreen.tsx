'use client';
import { useMemo } from 'react';
import { addDays, diffDays, fmtDayMonth, fmtLong, fmtRelative, plural, RU, startOfWeek, cap, weekday } from '../core/dates';
import { colorVars } from '../core/colors';
import { occurrencesInRange } from '../core/occurrences';
import type { ColorKey, Occurrence, Reminder } from '../core/types';
import { useStore } from '../state/store';
import { DayPager } from './DayPager';
import { greetingFor } from './hooks';
import { Calendar, ChevronLeft, ChevronRight, Plus, Sliders, Sparkles } from './icons';
import { ReminderCard } from './ReminderCard';

interface Props {
  date: string;
  today: string;
  time: string;
  zone: string;
  reminders: Reminder[];
  byId: Record<string, Reminder>;
  onDate: (d: string) => void;
  onOpenCalendar: () => void;
  onOpenSettings: () => void;
  onOpenAssistant: () => void;
  onToggle: (o: Occurrence) => void;
  onOpen: (o: Occurrence) => void;
  onCreate: () => void;
}

export function DayScreen(p: Props) {
  const settings = useStore((s) => s.settings);
  const weekStart = startOfWeek(p.date);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const weekOcc = useMemo(
    () => occurrencesInRange(p.reminders, weekStart, addDays(weekStart, 6), p.zone),
    [p.reminders, weekStart, p.zone],
  );
  const dots = useMemo(() => {
    const m: Record<string, ColorKey[]> = {};
    for (const o of weekOcc) {
      if (o.done) continue;
      (m[o.date] ||= []);
      if (!m[o.date].includes(o.color)) m[o.date].push(o.color);
    }
    return m;
  }, [weekOcc]);
  const dayOcc = useMemo(() => weekOcc.filter((o) => o.date === p.date), [weekOcc, p.date]);
  const allDay = dayOcc.filter((o) => o.time === null);
  const timed = dayOcc.filter((o) => o.time !== null);
  const left = dayOcc.filter((o) => !o.done).length;
  const isToday = p.date === p.today;
  const rel = diffDays(p.date, p.today);

  const title = Math.abs(rel) <= 1 ? fmtRelative(p.date, p.today) : cap(RU.WD_LONG[weekday(p.date) - 1]);
  const sub = Math.abs(rel) <= 1 ? fmtLong(p.date, p.today) : fmtDayMonth(p.date, p.today);
  const countText = dayOcc.length
    ? left
      ? `${left} ${plural(left, 'напоминание', 'напоминания', 'напоминаний')}`
      : 'Всё выполнено'
    : '';

  return (
    <>
      <header className="header">
        <div style={{ minWidth: 0 }}>
          <h1 className="greeting">
            {greetingFor(p.time, settings.greetings)}
            {settings.name ? <>,<br /><span className="name">{settings.name}</span></> : null}
          </h1>
          <div className="today-line">
            <span>{fmtLong(p.today)}</span>
            <button className="cal-btn" onClick={p.onOpenCalendar} aria-label="Открыть календарь">
              <Calendar size={18} />
            </button>
          </div>
        </div>
        <div className="header-actions">
          <button className="icon-btn ai" onClick={p.onOpenAssistant} aria-label="ИИ-ассистент">
            <Sparkles size={21} />
          </button>
          <button className="icon-btn" onClick={p.onOpenSettings} aria-label="Настройки">
            <Sliders size={21} />
          </button>
        </div>
      </header>

      <nav className="week" aria-label="Неделя">
        {weekDays.map((d, i) => (
          <button
            key={d}
            className={`wd ${d === p.today ? 'is-today' : ''} ${d === p.date ? 'is-sel' : ''}`}
            onClick={() => p.onDate(d)}
            aria-label={fmtLong(d, p.today)}
            aria-current={d === p.date ? 'date' : undefined}
          >
            <span className="wd-name">{RU.WD_SHORT[i]}</span>
            <span className="wd-num">{Number(d.slice(8))}</span>
            <span className="wd-dots">
              {(dots[d] || []).slice(0, 3).map((c) => (
                <i key={c} style={colorVars(c) as React.CSSProperties} />
              ))}
            </span>
          </button>
        ))}
      </nav>

      <DayPager date={p.date} onChange={p.onDate}>
        <div className="day-head">
          <div>
            <h2 className="day-title">{title}</h2>
            <div className="day-sub">
              {sub}
              {countText && <> · {countText}</>}
            </div>
          </div>
          {!isToday ? (
            <button key="today" className="today-pill" onClick={() => p.onDate(p.today)}>
              {rel > 0 ? <ChevronLeft size={16} strokeWidth={2.4} /> : null}
              Сегодня
              {rel < 0 ? <ChevronRight size={16} strokeWidth={2.4} /> : null}
            </button>
          ) : null}
        </div>

        {dayOcc.length === 0 ? (
          <Empty isToday={isToday} onCreate={p.onCreate} />
        ) : (
          <>
            {allDay.length > 0 && (
              <>
                <div className="section-label">Весь день</div>
                <div className="cards">
                  {allDay.map((o) => (
                    <ReminderCard key={o.uid} occ={o} reminder={p.byId[o.rid]} onToggle={p.onToggle} onOpen={p.onOpen} />
                  ))}
                </div>
              </>
            )}
            {timed.length > 0 && (
              <>
                {allDay.length > 0 && <div className="section-label">По времени</div>}
                <div className="cards">
                  {timed.map((o) => (
                    <ReminderCard key={o.uid} occ={o} reminder={p.byId[o.rid]} onToggle={p.onToggle} onOpen={p.onOpen} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </DayPager>
    </>
  );
}

function Empty({ isToday, onCreate }: { isToday: boolean; onCreate: () => void }) {
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden="true">
        <span className="c-bg" style={{ width: 74, height: 74, left: 8, top: 18, ...colorVars('sky') } as React.CSSProperties} />
        <span className="c-bg" style={{ width: 58, height: 58, left: 62, top: 4, ...colorVars('lavender') } as React.CSSProperties} />
        <span className="c-bg" style={{ width: 46, height: 46, left: 70, top: 56, ...colorVars('pink') } as React.CSSProperties} />
        <span className="c-bg" style={{ width: 22, height: 22, left: 40, top: 6, ...colorVars('mint') } as React.CSSProperties} />
      </div>
      <div className="empty-title">{isToday ? 'Свободный день' : 'Ничего не запланировано'}</div>
      <p>{isToday ? 'На сегодня напоминаний нет — можно выдохнуть.' : 'Свайпайте, чтобы листать дни.'}</p>
      <button className="btn-soft" onClick={onCreate}>
        <Plus size={18} /> Добавить
      </button>
    </div>
  );
}
