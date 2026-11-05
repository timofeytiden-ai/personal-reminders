'use client';
import { useState } from 'react';
import { colorVars } from '../core/colors';
import { zoneCity } from '../core/dates';
import { describeRule } from '../core/recurrence';
import type { Occurrence, Reminder } from '../core/types';
import { Check, Globe, Pause, Repeat, ArrowForward } from './icons';

interface Props {
  occ: Occurrence;
  reminder: Reminder;
  onToggle: (o: Occurrence) => void;
  onOpen: (o: Occurrence) => void;
  showDate?: string;
}

export function ReminderCard({ occ, reminder, onToggle, onOpen, showDate }: Props) {
  const [burst, setBurst] = useState(false);
  const cls = ['card', occ.done && 'is-done', occ.paused && 'is-paused'].filter(Boolean).join(' ');
  return (
    <div
      className={cls}
      style={colorVars(occ.color) as React.CSSProperties}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(occ)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(occ))}
      aria-label={`${occ.title}${occ.time ? ', ' + occ.time : ''}${occ.done ? ', выполнено' : ''}`}
    >
      <button
        className={`check ${occ.done ? 'on' : ''} ${burst ? 'burst' : ''}`}
        aria-label={occ.done ? 'Снять отметку' : 'Отметить выполненным'}
        aria-pressed={occ.done}
        onClick={(e) => {
          e.stopPropagation();
          if (!occ.done) {
            setBurst(true);
            setTimeout(() => setBurst(false), 500);
          }
          onToggle(occ);
        }}
      >
        <Check size={15} strokeWidth={3} />
      </button>
      <div className="card-body">
        <div className="card-top">
          <div className="card-title"><span className="strike">{occ.title}</span></div>
          {occ.time && <div className="card-time tabular">{occ.time}</div>}
        </div>
        {occ.notes && <div className="card-notes">{occ.notes}</div>}
        {(occ.recurring || occ.foreignZone || occ.paused || occ.moved || showDate) && (
          <div className="meta">
            {showDate && <span className="chip">{showDate}</span>}
            {occ.recurring && (
              <span className="chip"><Repeat />{describeRule(reminder.repeat, reminder.date)}</span>
            )}
            {occ.foreignZone && occ.anchorTime && (
              <span className="chip"><Globe />{occ.anchorTime} {zoneCity(occ.foreignZone)}</span>
            )}
            {occ.moved && occ.recurring && <span className="chip"><ArrowForward />Перенесено</span>}
            {occ.paused && <span className="chip"><Pause />На паузе</span>}
          </div>
        )}
      </div>
    </div>
  );
}
