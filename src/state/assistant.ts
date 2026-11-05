/**
 * Client side of the AI assistant: builds context, runs the tool-use loop,
 * executes tool calls against local state.
 */
import { addDays, diffDays, fmtLong, isValidDate, isValidTime, isValidZone, msToZoned, RU, weekday } from '../core/dates';
import { describeRule, normalizeRule } from '../core/recurrence';
import { nextOccurrence, occurrencesInRange } from '../core/occurrences';
import { draftFromReminder } from '../core/mutations';
import { COLOR_KEYS } from '../core/colors';
import type { AssistantContext } from '../core/assistant-tools';
import type { ColorKey, Draft, EditScope, Reminder, RepeatRule } from '../core/types';
import { addReminder, deleteReminder, editReminder, getReminder, postponeOccurrence, toggleDone, togglePaused } from './actions';
import { effectiveZone, getState, liveReminders } from './store';
import { getAccessToken } from './sync';

/* ---------- message types (Anthropic Messages API shape) ---------- */

export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface ApiMessage {
  role: 'user' | 'assistant';
  content: string | Block[];
}

/** What the chat UI shows. */
export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'action'; id: string; verb: string; rid: string | null; title: string; when: string; color: ColorKey; undo?: Reminder | 'delete' }
  | { kind: 'error'; id: string; text: string };

let seq = 0;
const nid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

/* ---------- context ---------- */

export function buildContext(): AssistantContext {
  const s = getState().settings;
  const zone = effectiveZone(s);
  const now = msToZoned(Date.now(), zone);
  const occ = occurrencesInRange(liveReminders(), now.date, addDays(now.date, 7), zone);
  const agenda = occ
    .slice(0, 60)
    .map((o) => `- ${o.date}${o.time ? ' ' + o.time : ' (весь день)'} · ${o.title}${o.done ? ' ✓' : ''}${o.recurring ? ' ↻' : ''} [id=${o.rid}, key=${o.key}]`)
    .join('\n');
  return { name: s.name, now: `${now.date} ${now.time}`, weekday: RU.WD_LONG[weekday(now.date) - 1], zone, today: now.date, agenda };
}

/* ---------- tool execution ---------- */

function toRule(input: unknown, start: string): RepeatRule {
  const r = (input || {}) as { type?: string; interval?: number; unit?: string; weekdays?: number[]; until?: string };
  const until = isValidDate(r.until) ? r.until : undefined;
  switch (r.type) {
    case 'daily': return normalizeRule({ freq: 'daily', interval: 1, until }, start);
    case 'weekly': return normalizeRule({ freq: 'weekly', interval: 1, byWeekday: r.weekdays?.length ? r.weekdays : [weekday(start)], until }, start);
    case 'monthly': return normalizeRule({ freq: 'monthly', interval: 1, until }, start);
    case 'yearly': return normalizeRule({ freq: 'yearly', interval: 1, until }, start);
    case 'weekdays': return normalizeRule({ freq: 'weekly', interval: 1, byWeekday: r.weekdays?.length ? r.weekdays : [1, 2, 3, 4, 5], until }, start);
    case 'custom': {
      const freq = ({ day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' } as const)[(r.unit || 'day') as 'day'] || 'daily';
      return normalizeRule({ freq, interval: r.interval || 2, byWeekday: r.weekdays, until }, start);
    }
    default: return { freq: 'none', interval: 1 };
  }
}

function whenText(date: string, time: string | null, rule: RepeatRule): string {
  const today = msToZoned(Date.now(), effectiveZone()).date;
  const d = diffDays(date, today);
  const day = d === 0 ? 'сегодня' : d === 1 ? 'завтра' : fmtLong(date, today);
  const t = time ? ` в ${time}` : '';
  const rep = rule.freq !== 'none' ? ` · ${describeRule(rule, date).toLowerCase()}` : '';
  return `${day}${t}${rep}`;
}

export interface ToolOutcome {
  result: Record<string, unknown>;
  action?: Extract<ChatItem, { kind: 'action' }>;
}

export function executeTool(name: string, input: Record<string, unknown>): ToolOutcome {
  const zone = effectiveZone();
  const today = msToZoned(Date.now(), zone).date;
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined);

  switch (name) {
    case 'create_reminder': {
      const date = str('date');
      if (!isValidDate(date)) return { result: { ok: false, error: 'date must be YYYY-MM-DD' } };
      const time = input.time === null || input.time === undefined ? null : String(input.time);
      if (time !== null && !isValidTime(time)) return { result: { ok: false, error: 'time must be HH:MM' } };
      const color = COLOR_KEYS.includes(input.color as ColorKey) ? (input.color as ColorKey) : 'sky';
      const alert = input.alert_minutes_before === null ? null : typeof input.alert_minutes_before === 'number' ? input.alert_minutes_before : getState().settings.defaultAlert;
      const tz = str('timezone');
      const draft: Draft = {
        title: str('title') || 'Напоминание',
        notes: str('notes') || '',
        color,
        date,
        time,
        tz: time && tz && isValidZone(tz) ? tz : null,
        repeat: toRule(input.repeat, date),
        alertOffset: alert,
      };
      const r = addReminder(draft);
      const first = nextOccurrence(r, r.date, zone);
      const when = whenText(first?.date ?? r.date, first?.time ?? r.time, r.repeat);
      return {
        result: {
          ok: true, id: r.id, title: r.title, start: r.date, time: r.time, repeat: describeRule(r.repeat, r.date),
          first_occurrence: first ? { date: first.date, time: first.time } : null,
        },
        action: { kind: 'action', id: nid(), verb: 'Создано', rid: r.id, title: r.title, when, color: r.color, undo: 'delete' },
      };
    }

    case 'list_reminders': {
      const from = str('from');
      let to = str('to');
      if (!isValidDate(from) || !isValidDate(to)) return { result: { ok: false, error: 'from/to must be YYYY-MM-DD' } };
      if (diffDays(to, from) > 366) to = addDays(from, 366);
      const includeDone = input.include_done !== false;
      const list = occurrencesInRange(liveReminders(), from, to, zone)
        .filter((o) => includeDone || !o.done)
        .slice(0, 200)
        .map((o) => ({
          id: o.rid, key: o.key, title: o.title, date: o.date, time: o.time, done: o.done, paused: o.paused,
          recurring: o.recurring, notes: o.notes || undefined,
        }));
      return { result: { ok: true, count: list.length, items: list } };
    }

    case 'find_reminders': {
      const q = (str('query') || '').toLowerCase().trim();
      const items = liveReminders()
        .filter((r) => !q || r.title.toLowerCase().includes(q) || r.notes.toLowerCase().includes(q))
        .slice(0, 50)
        .map((r) => {
          const next = nextOccurrence(r, today, zone);
          return {
            id: r.id, title: r.title, notes: r.notes || undefined, start: r.date, time: r.time,
            repeat: describeRule(r.repeat, r.date, true), paused: r.paused,
            next: next ? { key: next.key, date: next.date, time: next.time } : null,
          };
        });
      return { result: { ok: true, count: items.length, items } };
    }

    case 'update_reminder': {
      const r = getReminder(str('id') || '');
      if (!r) return { result: { ok: false, error: 'reminder not found' } };
      const snapshot = { ...r };
      const d = draftFromReminder(r);
      if (str('title') !== undefined) d.title = str('title')!;
      if (str('notes') !== undefined) d.notes = str('notes')!;
      if (isValidDate(str('date'))) d.date = str('date')!;
      if (input.time === null) d.time = null;
      else if (isValidTime(input.time)) d.time = input.time as string;
      if (input.repeat) d.repeat = toRule(input.repeat, d.date);
      if (COLOR_KEYS.includes(input.color as ColorKey)) d.color = input.color as ColorKey;
      if (input.alert_minutes_before === null) d.alertOffset = null;
      else if (typeof input.alert_minutes_before === 'number') d.alertOffset = input.alert_minutes_before;
      const changedFields = Object.keys(input).some((k) => !['id', 'paused'].includes(k));
      if (changedFields) {
        // series-level edit: editing from the first occurrence keeps dates aligned
        editReminder(r.id, r.repeat.freq === 'none' ? null : r.date, d, 'all');
      }
      if (typeof input.paused === 'boolean' && getReminder(r.id)?.paused !== input.paused) togglePaused(r.id);
      const nr = getReminder(r.id)!;
      return {
        result: { ok: true, id: nr.id, title: nr.title, date: nr.date, time: nr.time, repeat: describeRule(nr.repeat, nr.date), paused: nr.paused },
        action: { kind: 'action', id: nid(), verb: input.paused === true ? 'Приостановлено' : 'Изменено', rid: nr.id, title: nr.title, when: whenText(nr.date, nr.time, nr.repeat), color: nr.color, undo: snapshot },
      };
    }

    case 'complete_reminder': {
      const r = getReminder(str('id') || '');
      const key = str('key');
      if (!r || !key) return { result: { ok: false, error: 'reminder not found' } };
      const snapshot = { ...r };
      const done = toggleDone(r.id, key, input.done !== false);
      return {
        result: { ok: true, done },
        action: { kind: 'action', id: nid(), verb: done ? 'Выполнено' : 'Снята отметка', rid: r.id, title: r.overrides?.[key]?.title ?? r.title, when: whenText(key, null, { freq: 'none', interval: 1 }), color: r.color, undo: snapshot },
      };
    }

    case 'postpone_reminder': {
      const r = getReminder(str('id') || '');
      const key = str('key');
      const nd = str('new_date');
      if (!r || !key) return { result: { ok: false, error: 'reminder not found' } };
      if (!isValidDate(nd)) return { result: { ok: false, error: 'new_date must be YYYY-MM-DD' } };
      const nt = input.new_time === null ? null : isValidTime(input.new_time) ? (input.new_time as string) : (r.overrides?.[key]?.time ?? r.time);
      const snapshot = { ...r };
      postponeOccurrence(r.id, key, nd, nt);
      return {
        result: { ok: true, date: nd, time: nt },
        action: { kind: 'action', id: nid(), verb: 'Перенесено', rid: r.id, title: r.overrides?.[key]?.title ?? r.title, when: whenText(nd, nt, { freq: 'none', interval: 1 }), color: r.color, undo: snapshot },
      };
    }

    case 'delete_reminder': {
      const r = getReminder(str('id') || '');
      if (!r) return { result: { ok: false, error: 'reminder not found' } };
      const scope = (['all', 'this', 'following'].includes(str('scope') || '') ? str('scope') : 'all') as EditScope;
      const key = str('key') || null;
      if (scope !== 'all' && !key) return { result: { ok: false, error: 'key is required for this scope' } };
      const snapshot = { ...r };
      deleteReminder(r.id, key, scope);
      return {
        result: { ok: true },
        action: { kind: 'action', id: nid(), verb: scope === 'all' ? 'Удалено' : 'Удалено вхождение', rid: r.id, title: r.title, when: whenText(key || r.date, r.time, scope === 'all' ? r.repeat : { freq: 'none', interval: 1 }), color: r.color, undo: snapshot },
      };
    }
  }
  return { result: { ok: false, error: `unknown tool ${name}` } };
}

/* ---------- conversation loop ---------- */

export function trimHistory(messages: ApiMessage[], maxTurns = 12): ApiMessage[] {
  // a "turn" begins with a user message that contains plain text (not tool results)
  const starts: number[] = [];
  messages.forEach((m, i) => {
    if (m.role === 'user' && (typeof m.content === 'string' || m.content.some((b) => b.type === 'text'))) starts.push(i);
  });
  if (starts.length <= maxTurns) return messages;
  return messages.slice(starts[starts.length - maxTurns]);
}

export class AssistantError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function callApi(messages: ApiMessage[], signal?: AbortSignal): Promise<{ content: Block[]; stop_reason: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = await getAccessToken().catch(() => null);
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const pass = localStorage.getItem('rem:assistantPasscode');
    if (pass) headers['x-assistant-passcode'] = pass;
  } catch {
    /* ignore */
  }
  let res: Response;
  try {
    res = await fetch('/api/assistant', { method: 'POST', headers, body: JSON.stringify({ messages, context: buildContext() }), signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new AssistantError('network', 'Нет соединения с сервером. Ассистенту нужен интернет.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AssistantError(data.error || 'error', data.message || `Ошибка ${res.status}`);
  return data;
}

/**
 * Send a user message and run tool calls until the model finishes.
 * `emit` is called for every new chat item.
 */
export async function runAssistant(
  history: ApiMessage[],
  userText: string,
  emit: (item: ChatItem) => void,
  signal?: AbortSignal,
): Promise<ApiMessage[]> {
  let messages: ApiMessage[] = trimHistory([...history, { role: 'user', content: userText }]);
  for (let round = 0; round < 8; round++) {
    const resp = await callApi(messages, signal);
    messages = [...messages, { role: 'assistant', content: resp.content }];
    for (const b of resp.content) if (b.type === 'text' && b.text.trim()) emit({ kind: 'assistant', id: nid(), text: b.text.trim() });
    const calls = resp.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    if (resp.stop_reason !== 'tool_use' || !calls.length) return messages;
    const results: Block[] = calls.map((c) => {
      try {
        const out = executeTool(c.name, c.input || {});
        if (out.action) emit(out.action);
        return { type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out.result), is_error: out.result.ok === false };
      } catch (e) {
        return { type: 'tool_result', tool_use_id: c.id, content: JSON.stringify({ ok: false, error: String(e) }), is_error: true };
      }
    });
    messages = [...messages, { role: 'user', content: results }];
  }
  return messages;
}
