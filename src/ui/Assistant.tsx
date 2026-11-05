'use client';
import { useEffect, useRef, useState } from 'react';
import { colorVars } from '../core/colors';
import { AssistantError, runAssistant, type ApiMessage, type ChatItem } from '../state/assistant';
import { deleteReminder, restoreReminder } from '../state/actions';
import { useStore } from '../state/store';
import { Sheet } from './Sheet';
import { Send, Sparkles } from './icons';

const SUGGESTIONS = [
  'Напомни завтра в 9 утра позвонить маме',
  'Что у меня на этой неделе?',
  'Каждый понедельник, среду и пятницу в 7:30 — спортзал',
  'День рождения Ани 12 марта',
];

// conversation survives closing the sheet (but not a reload)
let savedHistory: ApiMessage[] = [];
let savedItems: ChatItem[] = [];

export function Assistant({ open, onClose }: { open: boolean; onClose: () => void }) {
  const name = useStore((s) => s.settings.name);
  const [items, setItems] = useState<ChatItem[]>(savedItems);
  const [history, setHistory] = useState<ApiMessage[]>(savedHistory);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [undone, setUndone] = useState<Record<string, boolean>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    savedItems = items;
    savedHistory = history;
  }, [items, history]);

  useEffect(() => {
    const el = scroller.current?.closest('.sheet-body') as HTMLElement | null;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [items, busy]);

  useEffect(() => {
    if (!open) abort.current?.abort();
  }, [open]);

  useEffect(() => {
    const el = input.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(120, el.scrollHeight) + 'px';
    }
  }, [text]);

  const send = async (msg: string) => {
    const m = msg.trim();
    if (!m || busy) return;
    setText('');
    setItems((x) => [...x, { kind: 'user', id: `u${Date.now()}`, text: m }]);
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const next = await runAssistant(history, m, (item) => setItems((x) => [...x, item]), ctrl.signal);
      setHistory(next);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        const text = e instanceof AssistantError || e instanceof Error ? e.message : String(e);
        setItems((x) => [...x, { kind: 'error', id: `e${Date.now()}`, text }]);
      }
    } finally {
      setBusy(false);
    }
  };

  const undo = (it: Extract<ChatItem, { kind: 'action' }>) => {
    if (it.undo === 'delete' && it.rid) deleteReminder(it.rid, null, 'all');
    else if (it.undo && it.undo !== 'delete') restoreReminder(it.undo);
    setUndone((u) => ({ ...u, [it.id]: true }));
  };

  const clear = () => {
    setItems([]);
    setHistory([]);
    setUndone({});
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      tall
      title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Sparkles size={18} />Ассистент</span>}
      label="ИИ-ассистент"
      left={items.length ? <button className="text-btn" onClick={clear}>Очистить</button> : null}
      right={<button className="text-btn strong" onClick={onClose}>Готово</button>}
      footer={
        <div className="composer">
          <textarea
            ref={input}
            rows={1}
            placeholder="Напишите, что напомнить…"
            value={text}
            enterKeyHint="send"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(text);
              }
            }}
          />
          <button className="send" aria-label="Отправить" disabled={!text.trim() || busy} onClick={() => void send(text)}>
            <Send size={20} strokeWidth={2.4} />
          </button>
        </div>
      }
    >
      <div ref={scroller} className="chat">
        {!items.length && (
          <div className="ai-hello">
            <div className="ai-orb"><Sparkles size={30} /></div>
            <h3>Привет{name ? `, ${name}` : ''}!</h3>
            <p>Я создам, найду, перенесу или отмечу напоминания — просто напишите, что нужно.</p>
            <div className="suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => void send(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {items.map((it) => {
          if (it.kind === 'user') return <div key={it.id} className="bubble me">{it.text}</div>;
          if (it.kind === 'assistant') return <div key={it.id} className="bubble ai">{it.text}</div>;
          if (it.kind === 'error') return <div key={it.id} className="bubble err">{it.text}</div>;
          return (
            <div key={it.id} className="act" style={colorVars(it.color) as React.CSSProperties}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="a-verb">{undone[it.id] ? 'Отменено' : it.verb}</div>
                <div className="a-title">{it.title}</div>
                <div className="a-when">{it.when}</div>
              </div>
              {it.undo && !undone[it.id] && <button onClick={() => undo(it)}>Отменить</button>}
            </div>
          );
        })}
        {busy && <div className="typing" aria-label="Ассистент печатает"><i /><i /><i /></div>}
      </div>
    </Sheet>
  );
}
