'use client';
import { useEffect, useState, type ReactNode } from 'react';

export interface ToastOpts {
  text: string;
  sub?: string;
  icon?: ReactNode;
  action?: { label: string; fn: () => void };
  duration?: number;
}

interface Item extends ToastOpts {
  id: number;
  out?: boolean;
}

let listeners: ((t: Item) => void)[] = [];
let n = 0;

export function toast(t: ToastOpts) {
  const item = { ...t, id: ++n };
  listeners.forEach((l) => l(item));
}

export function Toasts() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    const add = (t: Item) => {
      // one toast at a time: the previous one slides out
      setItems((list) => [...list.map((x) => ({ ...x, out: true })), t]);
      setTimeout(() => setItems((list) => list.filter((x) => !x.out || x.id === t.id)), 260);
      const life = t.duration ?? 4000;
      setTimeout(() => setItems((list) => list.map((x) => (x.id === t.id ? { ...x, out: true } : x))), life);
      setTimeout(() => setItems((list) => list.filter((x) => x.id !== t.id)), life + 260);
    };
    listeners.push(add);
    return () => {
      listeners = listeners.filter((l) => l !== add);
    };
  }, []);
  const dismiss = (id: number) => {
    setItems((list) => list.map((x) => (x.id === id ? { ...x, out: true } : x)));
    setTimeout(() => setItems((list) => list.filter((x) => x.id !== id)), 260);
  };
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.out ? 'out' : ''}`} role="status">
          {t.icon && <div className="t-icon">{t.icon}</div>}
          <div className="t-text">
            {t.text}
            {t.sub && <small>{t.sub}</small>}
          </div>
          {t.action && (
            <button
              onClick={() => {
                t.action!.fn();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
