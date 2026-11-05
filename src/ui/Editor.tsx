'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addMonths, allZones, cmp, fmtLong, isValidTime, nowTimeIn, offsetLabel, RU, weekday, zoneCity } from '../core/dates';
import { COLORS, colorOf, colorVars } from '../core/colors';
import { describeRule, presetOf, ruleFromPreset, type RepeatPreset, unitWord } from '../core/recurrence';
import type { Draft, Freq } from '../core/types';
import { Sheet, Switch } from './Sheet';
import { MonthGrid } from './MonthGrid';
import { Bell, Calendar, ChevronDown, Clock, Globe, Repeat, Trash } from './icons';

const PRESETS: { key: RepeatPreset; label: string }[] = [
  { key: 'none', label: 'Не повторять' },
  { key: 'daily', label: 'Каждый день' },
  { key: 'weekly', label: 'Каждую неделю' },
  { key: 'monthly', label: 'Каждый месяц' },
  { key: 'yearly', label: 'Каждый год' },
  { key: 'weekdays', label: 'По дням недели' },
  { key: 'custom', label: 'Свой интервал' },
];

export const ALERTS: { v: number | null; label: string }[] = [
  { v: null, label: 'Без уведомления' },
  { v: 0, label: 'В момент события' },
  { v: 5, label: 'За 5 минут' },
  { v: 10, label: 'За 10 минут' },
  { v: 15, label: 'За 15 минут' },
  { v: 30, label: 'За 30 минут' },
  { v: 60, label: 'За 1 час' },
  { v: 120, label: 'За 2 часа' },
  { v: 1440, label: 'За 1 день' },
  { v: 2880, label: 'За 2 дня' },
  { v: 10080, label: 'За неделю' },
];

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  initial: Draft;
  today: string;
  zone: string;
  allDayTime: string;
  onClose: () => void;
  onSave: (d: Draft) => void;
  onDelete?: () => void;
}

export function Editor(props: Props) {
  return (
    <Sheet open={props.open} onClose={props.onClose} tall label={props.mode === 'create' ? 'Новое напоминание' : 'Редактирование'}>
      <EditorBody key={JSON.stringify(props.initial)} {...props} />
    </Sheet>
  );
}

function EditorBody({ mode, initial, today, zone, allDayTime, onClose, onSave, onDelete }: Props) {
  const [d, setD] = useState<Draft>(initial);
  const [open, setOpen] = useState<'date' | 'repeat' | 'until' | null>(null);
  const [month, setMonth] = useState(initial.date);
  const [untilMonth, setUntilMonth] = useState(initial.repeat.until || initial.date);
  const titleRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const zones = useMemo(() => allZones(), []);
  const preset = presetOf(d.repeat, d.date);

  useEffect(() => {
    if (mode === 'create') {
      const t = setTimeout(() => titleRef.current?.focus(), 380);
      return () => clearTimeout(t);
    }
  }, [mode]);

  useEffect(() => {
    const el = notesRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(220, el.scrollHeight) + 'px';
    }
  }, [d.notes]);

  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  const setDate = (date: string) => {
    setD((x) => {
      let repeat = x.repeat;
      // keep "every week" on the weekday of the new start date
      if (x.repeat.freq === 'weekly' && x.repeat.byWeekday?.length === 1 && x.repeat.byWeekday[0] === weekday(x.date)) {
        repeat = { ...x.repeat, byWeekday: [weekday(date)] };
      }
      if (repeat.until && cmp(repeat.until, date) < 0) repeat = { ...repeat, until: undefined };
      return { ...x, date, repeat };
    });
  };

  const setPreset = (p: RepeatPreset) => set({ repeat: ruleFromPreset(p, d.date, d.repeat) });

  const toggleWd = (wd: number) => {
    const cur = d.repeat.byWeekday?.length ? d.repeat.byWeekday : [weekday(d.date)];
    const next = cur.includes(wd) ? cur.filter((x) => x !== wd) : [...cur, wd];
    if (!next.length) return;
    set({ repeat: { ...d.repeat, freq: 'weekly', byWeekday: next.sort() } });
  };

  const canSave = d.title.trim().length > 0 && (d.time === null || isValidTime(d.time));
  const color = colorOf(d.color);
  const isTimeOn = d.time !== null;

  const alertOptions = ALERTS.map((a) =>
    a.v === 0 && !isTimeOn ? { ...a, label: `В день события (${allDayTime})` } : a,
  );

  return (
    <>
      <div className="sheet-head editor-head">
        <button className="text-btn" onClick={onClose}>Отмена</button>
        <div className="sheet-title">{mode === 'create' ? 'Новое' : 'Изменить'}</div>
        <button className="text-btn strong" disabled={!canSave} onClick={() => onSave({ ...d, title: d.title.trim() })}>
          Готово
        </button>
      </div>

      <input
        ref={titleRef}
        className="title-input"
        placeholder="Что напомнить?"
        value={d.title}
        maxLength={200}
        enterKeyHint="next"
        onChange={(e) => set({ title: e.target.value })}
        onKeyDown={(e) => e.key === 'Enter' && notesRef.current?.focus()}
      />
      <textarea
        ref={notesRef}
        className="notes-input"
        placeholder="Описание"
        rows={1}
        value={d.notes}
        onChange={(e) => set({ notes: e.target.value })}
      />

      <div className="palette" role="radiogroup" aria-label="Цвет">
        {COLORS.map((c) => (
          <button
            key={c.key}
            className={`swatch ${d.color === c.key ? 'on' : ''}`}
            style={colorVars(c.key) as React.CSSProperties}
            role="radio"
            aria-checked={d.color === c.key}
            aria-label={`${c.name} — ${c.hint}`}
            onClick={() => set({ color: c.key })}
          />
        ))}
      </div>
      <div className="palette-caption">{color.name} · {color.hint}</div>

      <div className="group" style={{ marginTop: 16 }}>
        <button className="row" onClick={() => setOpen(open === 'date' ? null : 'date')} aria-expanded={open === 'date'}>
          <span className="row-icon" style={{ background: '#E0605A' }}><Calendar /></span>
          <span className="row-label">Дата</span>
          <span className="row-value accent">{fmtLong(d.date, today)}</span>
        </button>
        {open === 'date' && (
          <div className="inline-panel">
            <MonthGrid
              compact
              month={month}
              onMonth={setMonth}
              selected={d.date}
              today={today}
              onSelect={(x) => {
                setDate(x);
                setOpen(null);
              }}
            />
          </div>
        )}

        <div className="row static">
          <span className="row-icon" style={{ background: '#5B8DEF' }}><Clock /></span>
          <span className="row-label">Время</span>
          {isTimeOn && (
            <input
              type="time"
              className="time-input"
              value={d.time ?? ''}
              aria-label="Время"
              onChange={(e) => set({ time: e.target.value || '09:00' })}
            />
          )}
          <Switch
            label="Указать время"
            checked={isTimeOn}
            onChange={(on) => set({ time: on ? defaultTime(d.date, today, zone) : null, tz: on ? d.tz : null })}
          />
        </div>

        <button className="row" onClick={() => setOpen(open === 'repeat' ? null : 'repeat')} aria-expanded={open === 'repeat'}>
          <span className="row-icon" style={{ background: '#8467D2' }}><Repeat /></span>
          <span className="row-label">Повтор</span>
          <span className="row-value accent" style={{ whiteSpace: 'normal' }}>{describeRule(d.repeat, d.date, true)}</span>
        </button>
        {open === 'repeat' && (
          <div className="inline-panel">
            <div className="chips">
              {PRESETS.map((p) => (
                <button key={p.key} className={`pchip ${preset === p.key ? 'on' : ''}`} onClick={() => setPreset(p.key)}>
                  {p.label}
                </button>
              ))}
            </div>

            {preset === 'custom' && (
              <>
                <div className="sub-label">Интервал</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600 }}>Каждые</span>
                  <div className="stepper">
                    <button aria-label="Меньше" onClick={() => set({ repeat: { ...d.repeat, interval: Math.max(1, d.repeat.interval - 1) } })}>−</button>
                    <span>{d.repeat.interval}</span>
                    <button aria-label="Больше" onClick={() => set({ repeat: { ...d.repeat, interval: Math.min(99, d.repeat.interval + 1) } })}>+</button>
                  </div>
                  <span style={{ color: 'var(--text-2)' }}>{unitWord(d.repeat.freq, d.repeat.interval)}</span>
                </div>
                <div className="seg" style={{ marginTop: 10 }}>
                  {(['daily', 'weekly', 'monthly', 'yearly'] as Freq[]).map((f) => (
                    <button
                      key={f}
                      className={d.repeat.freq === f ? 'on' : ''}
                      onClick={() => set({ repeat: { ...d.repeat, freq: f, byWeekday: f === 'weekly' ? [weekday(d.date)] : undefined } })}
                    >
                      {{ daily: 'Дни', weekly: 'Недели', monthly: 'Месяцы', yearly: 'Годы' }[f as 'daily']}
                    </button>
                  ))}
                </div>
              </>
            )}

            {(preset === 'weekdays' || (preset === 'custom' && d.repeat.freq === 'weekly')) && (
              <>
                <div className="sub-label">Дни недели</div>
                <div className="wdchips">
                  {RU.WD_SHORT.map((name, i) => {
                    const on = (d.repeat.byWeekday?.length ? d.repeat.byWeekday : [weekday(d.date)]).includes(i + 1);
                    return (
                      <button key={name} className={on ? 'on' : ''} aria-pressed={on} onClick={() => toggleWd(i + 1)}>
                        {name}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {d.repeat.freq !== 'none' && (
              <>
                <div className="sub-label">Окончание</div>
                <div className="seg">
                  <button className={!d.repeat.until ? 'on' : ''} onClick={() => set({ repeat: { ...d.repeat, until: undefined } })}>
                    Никогда
                  </button>
                  <button
                    className={d.repeat.until ? 'on' : ''}
                    onClick={() => {
                      const until = d.repeat.until || addMonths(d.date, 1);
                      setUntilMonth(until);
                      set({ repeat: { ...d.repeat, until } });
                      setOpen('until');
                    }}
                  >
                    До даты
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {open === 'until' && d.repeat.until && (
          <div className="inline-panel">
            <div className="sub-label" style={{ marginTop: 4 }}>Повторять до {fmtLong(d.repeat.until, today)}</div>
            <MonthGrid
              compact
              month={untilMonth}
              onMonth={setUntilMonth}
              selected={d.repeat.until}
              today={today}
              min={d.date}
              onSelect={(x) => {
                set({ repeat: { ...d.repeat, until: x } });
                setOpen('repeat');
              }}
            />
          </div>
        )}

        <div className="row static">
          <span className="row-icon" style={{ background: '#E39A3B' }}><Bell /></span>
          <span className="row-label">Уведомить</span>
          <span className="select-wrap">
            <select
              aria-label="Когда уведомить"
              value={d.alertOffset === null ? 'none' : String(d.alertOffset)}
              onChange={(e) => set({ alertOffset: e.target.value === 'none' ? null : Number(e.target.value) })}
            >
              {alertOptions.map((a) => (
                <option key={String(a.v)} value={a.v === null ? 'none' : String(a.v)}>{a.label}</option>
              ))}
              {d.alertOffset !== null && !ALERTS.some((a) => a.v === d.alertOffset) && (
                <option value={String(d.alertOffset)}>За {d.alertOffset} мин</option>
              )}
            </select>
            <ChevronDown />
          </span>
        </div>

        {isTimeOn && (
          <>
            <div className="row static">
              <span className="row-icon" style={{ background: '#2E9C84' }}><Globe /></span>
              <span className="row-label" style={{ whiteSpace: 'nowrap' }}>Пояс</span>
              <span className="select-wrap">
                <select
                  aria-label="Часовой пояс напоминания"
                  value={d.tz ?? ''}
                  onChange={(e) => set({ tz: e.target.value || null })}
                >
                  <option value="">Местное время</option>
                  <option value={zone}>{zoneCity(zone)} · {offsetLabel(zone)}</option>
                  {zones.filter((z) => z !== zone).map((z) => (
                    <option key={z} value={z}>{zoneCity(z)} · {offsetLabel(z)}</option>
                  ))}
                </select>
                <ChevronDown />
              </span>
            </div>
            <div className="row-hint">
              {d.tz
                ? `${d.time} по времени ${zoneCity(d.tz)} — событие привязано к этому поясу и в поездке покажется в пересчёте на местное время.`
                : 'Следует за вами: 09:00 останется 09:00 в любой стране.'}
            </div>
          </>
        )}
      </div>

      {mode === 'edit' && onDelete && (
        <button className="danger-btn" onClick={onDelete}>
          <Trash size={19} /> Удалить напоминание
        </button>
      )}
      <div style={{ height: 30 }} />
    </>
  );
}

function defaultTime(date: string, today: string, zone: string): string {
  if (date !== today) return '09:00';
  const h = Math.min(23, Number(nowTimeIn(zone).slice(0, 2)) + 1);
  return `${String(h).padStart(2, '0')}:00`;
}
