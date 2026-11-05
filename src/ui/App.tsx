'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { draftFromOccurrence, canEditOnlyThis } from '../core/mutations';
import { isRecurring } from '../core/recurrence';
import { nowTimeIn, fmtRelative, todayIn } from '../core/dates';
import type { Draft, EditScope, Occurrence, Reminder } from '../core/types';
import { useStore, effectiveZone, loadLocal, refreshNextFire } from '../state/store';
import {
  addReminder, deleteReminder, editReminder, getReminder, postponeOccurrence, restoreReminder, toggleDone, togglePaused,
} from '../state/actions';
import { initSync } from '../state/sync';
import {
  onFire, primeAudio, refreshPushState, registerServiceWorker, startScheduler,
} from '../notify/notify';
import { occurrenceByKey } from '../core/occurrences';
import { useClock, useReminders, useTheme } from './hooks';
import { DayScreen } from './DayScreen';
import { Editor } from './Editor';
import { ActionSheet, CalendarSheet, PostponeSheet, ScopeSheet, type ScopeRequest } from './Sheets';
import { AllView, DoneView, UpcomingView } from './ListViews';
import { SettingsPanel } from './Settings';
import { Assistant } from './Assistant';
import { Toasts, toast } from './Toast';
import { Bell, Check, CheckCircle, Inbox, ListIcon, Plus, Today, Trash } from './icons';

type Tab = 'day' | 'upcoming' | 'all' | 'done';

interface EditorState {
  mode: 'create' | 'edit';
  rid?: string;
  key?: string | null;
  initial: Draft;
}

let booted = false;

export default function App() {
  const loaded = useStore((s) => s.loaded);
  useTheme();

  useEffect(() => {
    if (booted) return;
    booted = true;
    void (async () => {
      await loadLocal();
      refreshNextFire();
      primeAudio();
      await registerServiceWorker();
      startScheduler();
      await initSync();
      await refreshPushState();
    })();
  }, []);

  if (!loaded) {
    return (
      <div className="splash">
        <div className="splash-dot" />
      </div>
    );
  }
  return <Main />;
}

function Main() {
  const { today, zone, time } = useClock();
  const reminders = useReminders();
  const byId = useStore((s) => s.reminders);
  const settings = useStore((s) => s.settings);

  const [tab, setTab] = useState<Tab>('day');
  const [date, setDate] = useState(today);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [lastEditor, setLastEditor] = useState<EditorState | null>(null);
  if (editor && editor !== lastEditor) setLastEditor(editor);
  const shownEditor = editor ?? lastEditor;
  const [action, setAction] = useState<{ rid: string; key: string } | null>(null);
  const [postponeFor, setPostponeFor] = useState<Occurrence | null>(null);
  const [scope, setScope] = useState<ScopeRequest | null>(null);
  const [calendar, setCalendar] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [assistant, setAssistant] = useState(false);

  // always reopen on today; follow midnight rollover if the user was on "today"
  const [lastToday, setLastToday] = useState(today);
  if (lastToday !== today) {
    setLastToday(today);
    if (date === lastToday) setDate(today);
  }
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && document.hidden === false) {
        // returning after a while → show today
        const hiddenAt = Number(sessionStorage.getItem('rem:hiddenAt') || 0);
        if (hiddenAt && Date.now() - hiddenAt > 10 * 60_000) {
          setDate(getTodayNow());
          setTab('day');
        }
      } else {
        sessionStorage.setItem('rem:hiddenAt', String(Date.now()));
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // in-app banner when a reminder fires
  useEffect(
    () =>
      onFire((e) =>
        toast({
          text: e.title,
          sub: e.body,
          icon: <Bell size={18} />,
          duration: 8000,
          action: {
            label: 'Готово',
            fn: () => toggleDone(e.rid, e.key, true),
          },
        }),
      ),
    [],
  );

  // the occurrence shown in the action sheet, kept fresh from the store
  const actionOcc = useMemo(() => {
    if (!action) return null;
    const r = byId[action.rid];
    if (!r || r.deletedAt) return null;
    return occurrenceByKey(r, action.key, zone);
  }, [action, byId, zone]);
  const actionRem = action ? byId[action.rid] ?? null : null;

  /* ---------- handlers ---------- */

  const onToggle = useCallback((o: Occurrence) => {
    const snapshot = getReminder(o.rid);
    const done = toggleDone(o.rid, o.key);
    if (done && snapshot) {
      toast({
        text: 'Выполнено',
        sub: o.title,
        icon: <Check size={18} strokeWidth={2.6} />,
        action: { label: 'Отменить', fn: () => toggleDone(o.rid, o.key, false) },
      });
    }
  }, []);

  const openCreate = () => {
    const d = tab === 'day' ? date : today;
    const hour = d === today ? Math.min(23, Number(nowTimeIn(zone).slice(0, 2)) + 1) : 9;
    setEditor({
      mode: 'create',
      initial: {
        title: '', notes: '', color: 'sky', date: d, time: `${String(hour).padStart(2, '0')}:00`, tz: null,
        repeat: { freq: 'none', interval: 1 }, alertOffset: settings.defaultAlert,
      },
    });
  };

  const openEdit = (rid: string, key: string) => {
    const r = getReminder(rid);
    if (!r) return;
    setAction(null);
    setEditor({ mode: 'edit', rid, key, initial: draftFromOccurrence(r, key) });
  };

  const saveEditor = (draft: Draft) => {
    if (!editor) return;
    if (editor.mode === 'create') {
      const r = addReminder(draft);
      setEditor(null);
      const occ = occurrenceByKey(r, r.date, zone);
      toast({
        text: 'Напоминание создано',
        sub: occ ? `${fmtRelative(occ.date, today)}${occ.time ? ', ' + occ.time : ''}` : r.title,
        icon: <CheckCircle size={18} />,
      });
      if (tab === 'day' && occ && occ.date !== date) setDate(occ.date);
      return;
    }
    const r = getReminder(editor.rid!);
    if (!r) return setEditor(null);
    const apply = (s: EditScope) => {
      editReminder(r.id, editor.key ?? null, draft, s);
      setScope(null);
      setEditor(null);
      toast({ text: 'Изменения сохранены', icon: <Check size={18} strokeWidth={2.6} /> });
    };
    if (isRecurring(r.repeat)) {
      setScope({ kind: 'edit', allowThis: canEditOnlyThis(r, draft), onPick: apply });
    } else apply('all');
  };

  const requestDelete = (rid: string, key: string | null) => {
    const r = getReminder(rid);
    if (!r) return;
    const snapshot: Reminder = { ...r };
    const apply = (s: EditScope) => {
      deleteReminder(rid, key, s);
      setScope(null);
      setAction(null);
      setEditor(null);
      toast({
        text: s === 'this' ? 'Повтор удалён' : 'Удалено',
        sub: r.title,
        icon: <Trash size={18} />,
        action: { label: 'Отменить', fn: () => restoreReminder({ ...snapshot, deletedAt: null }) },
      });
    };
    if (isRecurring(r.repeat) && key) setScope({ kind: 'delete', allowThis: true, onPick: apply });
    else apply('all');
  };

  const openSeries = (r: Reminder, next: Occurrence | null) => {
    if (next) setAction({ rid: r.id, key: next.key });
    else setEditor({ mode: 'edit', rid: r.id, key: r.date, initial: draftFromOccurrence(r, r.date) });
  };

  const common = { reminders, byId, today, zone, onToggle, onOpen: (o: Occurrence) => setAction({ rid: o.rid, key: o.key }) };

  return (
    <>
      <main className="app">
        {tab === 'day' && (
          <DayScreen
            {...common}
            date={date}
            time={time}
            onDate={setDate}
            onOpenCalendar={() => setCalendar(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenAssistant={() => setAssistant(true)}
            onCreate={openCreate}
          />
        )}
        {tab === 'upcoming' && <UpcomingView {...common} />}
        {tab === 'all' && <AllView {...common} onOpenSeries={openSeries} />}
        {tab === 'done' && <DoneView {...common} />}
      </main>

      <button className="fab" onClick={openCreate} aria-label="Новое напоминание">
        <Plus strokeWidth={2.4} />
      </button>

      <nav className="tabbar" aria-label="Разделы">
        {(
          [
            ['day', 'Сегодня', <Today key="i" />],
            ['upcoming', 'Предстоящие', <Inbox key="i" />],
            ['all', 'Все', <ListIcon key="i" />],
            ['done', 'Выполненные', <CheckCircle key="i" />],
          ] as const
        ).map(([k, label, icon]) => (
          <button
            key={k}
            className={`tab ${tab === k ? 'on' : ''}`}
            aria-current={tab === k ? 'page' : undefined}
            onClick={() => {
              if (k === 'day' && tab === 'day') setDate(today);
              setTab(k);
              window.scrollTo({ top: 0 });
            }}
          >
            {icon}
            {label}
          </button>
        ))}
      </nav>

      <Editor
        open={!!editor}
        mode={shownEditor?.mode ?? 'create'}
        initial={shownEditor?.initial ?? EMPTY}
        today={today}
        zone={zone}
        allDayTime={settings.allDayAlertTime}
        onClose={() => setEditor(null)}
        onSave={saveEditor}
        onDelete={shownEditor?.rid ? () => requestDelete(shownEditor.rid!, shownEditor.key ?? null) : undefined}
      />

      <ActionSheet
        occ={actionOcc}
        reminder={actionRem}
        today={today}
        onClose={() => setAction(null)}
        onToggle={() => {
          if (actionOcc) onToggle(actionOcc);
          setAction(null);
        }}
        onEdit={() => action && openEdit(action.rid, action.key)}
        onPostpone={() => actionOcc && setPostponeFor(actionOcc)}
        onPause={() => {
          if (!actionRem) return;
          togglePaused(actionRem.id);
          toast({ text: actionRem.paused ? 'Напоминание включено' : 'Напоминание отключено', sub: actionRem.title });
          setAction(null);
        }}
        onDelete={() => action && requestDelete(action.rid, action.key)}
      />

      <PostponeSheet
        occ={postponeFor}
        today={today}
        zone={zone}
        onClose={() => setPostponeFor(null)}
        onPick={(d, t) => {
          if (!postponeFor) return;
          postponeOccurrence(postponeFor.rid, postponeFor.key, d, t);
          toast({ text: 'Перенесено', sub: `${fmtRelative(d, today)}${t ? ', ' + t : ''}`, icon: <Check size={18} strokeWidth={2.6} /> });
          setPostponeFor(null);
          setAction(null);
        }}
      />

      <ScopeSheet req={scope} onClose={() => setScope(null)} />

      <CalendarSheet
        open={calendar}
        selected={date}
        today={today}
        zone={zone}
        reminders={reminders}
        onClose={() => setCalendar(false)}
        onPick={(d) => {
          setDate(d);
          setTab('day');
          setCalendar(false);
        }}
      />

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Assistant open={assistant} onClose={() => setAssistant(false)} />
      <Toasts />
    </>
  );
}

const EMPTY: Draft = {
  title: '', notes: '', color: 'sky', date: '2000-01-01', time: null, tz: null, repeat: { freq: 'none', interval: 1 }, alertOffset: 0,
};

function getTodayNow(): string {
  return todayIn(effectiveZone());
}
