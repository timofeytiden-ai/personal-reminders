'use client';
import { useState } from 'react';
import { addDays, addMonths, parseDate, RU, startOfMonth, startOfWeek } from '../core/dates';
import { colorVars } from '../core/colors';
import type { ColorKey } from '../core/types';
import { ChevronDown, ChevronLeft, ChevronRight } from './icons';

interface Props {
  month: string; // any date inside the month
  onMonth: (m: string) => void;
  selected?: string | null;
  today: string;
  dots?: Record<string, ColorKey[]>;
  onSelect: (d: string) => void;
  compact?: boolean;
  min?: string;
}

export function MonthGrid({ month, onMonth, selected, today, dots, onSelect, compact, min }: Props) {
  const [picker, setPicker] = useState(false);
  const first = startOfMonth(month);
  const p = parseDate(first);
  const gridStart = startOfWeek(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  // trim a trailing week that is entirely in the next month
  const visible = days.slice(35, 42).every((d) => d.slice(0, 7) !== first.slice(0, 7)) ? days.slice(0, 35) : days;

  return (
    <div>
      <div className="month-head">
        <button className={`month-title ${picker ? 'open' : ''}`} onClick={() => setPicker(!picker)} aria-expanded={picker}>
          {RU.MONTHS_NOM[p.m - 1]} {p.y}
          <ChevronDown />
        </button>
        <div className="month-nav">
          <button className="icon-btn small" aria-label="Предыдущий месяц" onClick={() => onMonth(addMonths(first, picker ? -12 : -1, 1))}>
            <ChevronLeft size={18} />
          </button>
          <button className="icon-btn small" aria-label="Следующий месяц" onClick={() => onMonth(addMonths(first, picker ? 12 : 1, 1))}>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {picker ? (
        <div>
          <div className="year-row">
            <span>{p.y}</span>
          </div>
          <div className="picker-grid">
            {RU.MONTHS_NOM.map((name, i) => (
              <button
                key={name}
                className={i + 1 === p.m ? 'on' : ''}
                onClick={() => {
                  onMonth(`${p.y}-${String(i + 1).padStart(2, '0')}-01`);
                  setPicker(false);
                }}
              >
                {name.slice(0, 3)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className={`mgrid ${compact ? 'compact' : ''}`} role="grid">
          {RU.WD_SHORT.map((d) => (
            <div key={d} className="dow">{d}</div>
          ))}
          {visible.map((d) => {
            const out = d.slice(0, 7) !== first.slice(0, 7);
            const disabled = !!min && d < min;
            const cls = ['mday', out && 'out', d === today && 'today', d === selected && 'sel'].filter(Boolean).join(' ');
            const ds = dots?.[d] || [];
            return (
              <button
                key={d}
                className={cls}
                disabled={disabled}
                style={disabled ? { opacity: 0.3 } : undefined}
                onClick={() => onSelect(d)}
                aria-label={d}
                aria-pressed={d === selected}
              >
                <span className="n">{Number(d.slice(8))}</span>
                {ds.length > 0 && (
                  <span className="dots">
                    {ds.slice(0, 3).map((c, i) => (
                      <i key={i} style={colorVars(c) as React.CSSProperties} />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
