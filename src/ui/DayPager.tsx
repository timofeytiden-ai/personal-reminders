'use client';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { addDays, cmp } from '../core/dates';

interface Props {
  date: string;
  onChange: (d: string) => void;
  children: ReactNode;
}

/**
 * Horizontal swipe between days with a page-turn animation.
 * Swipe left → next day, swipe right → previous day.
 * Uses `touch-action: pan-y`, so vertical scrolling stays native; the
 * gesture locks to one axis after a few pixels to avoid conflicts.
 */
export function DayPager({ date, onChange, children }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const prev = useRef(date);
  const pendingDir = useRef<number | null>(null);
  const g = useRef<{ x: number; y: number; t: number; axis: 'x' | 'y' | null; dx: number; id: number } | null>(null);
  const suppressClick = useRef(false);
  const busy = useRef(false);

  // enter animation whenever the date changes (swipe, week strip, calendar…)
  useLayoutEffect(() => {
    if (prev.current === date) return;
    const dir = pendingDir.current ?? (cmp(date, prev.current) > 0 ? 1 : -1);
    pendingDir.current = null;
    prev.current = date;
    const el = page.current;
    if (!el || typeof el.animate !== 'function') return;
    el.getAnimations?.().forEach((a) => a.cancel());
    el.style.transform = '';
    el.style.opacity = '';
    el.animate(
      [
        { transform: `translateX(${dir * 38}%) rotateY(${-dir * 10}deg)`, opacity: 0 },
        { transform: 'translateX(0) rotateY(0)', opacity: 1 },
      ],
      { duration: 360, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
  }, [date]);

  const go = (dir: 1 | -1, fromDx = 0) => {
    const el = page.current;
    const target = addDays(date, dir);
    if (!el || typeof el.animate !== 'function') {
      onChange(target);
      return;
    }
    busy.current = true;
    const w = wrap.current?.offsetWidth || 360;
    const anim = el.animate(
      [
        { transform: `translateX(${fromDx}px) rotateY(${(-fromDx / w) * 12}deg)`, opacity: 1 - Math.min(0.5, Math.abs(fromDx) / w) },
        { transform: `translateX(${-dir * 55}%) rotateY(${dir * 14}deg)`, opacity: 0 },
      ],
      { duration: 170, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
    );
    anim.onfinish = () => {
      el.style.transform = '';
      el.style.opacity = '';
      pendingDir.current = dir;
      anim.cancel();
      busy.current = false;
      onChange(target);
    };
  };

  // keyboard ← → on desktop
  const dateRef = useRef(date);
  dateRef.current = date;
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (document.documentElement.style.overflow === 'hidden') return; // a sheet is open
      if (e.key === 'ArrowRight') goRef.current(1);
      if (e.key === 'ArrowLeft') goRef.current(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onDown = (e: React.PointerEvent) => {
    if (busy.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    g.current = { x: e.clientX, y: e.clientY, t: performance.now(), axis: null, dx: 0, id: e.pointerId };
    suppressClick.current = false;
  };

  const onMove = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.axis) {
      if (Math.abs(dx) > 9 && Math.abs(dx) > Math.abs(dy) * 1.25) {
        s.axis = 'x';
        try {
          wrap.current?.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      } else if (Math.abs(dy) > 9) {
        s.axis = 'y';
      }
    }
    if (s.axis !== 'x' || !page.current) return;
    s.dx = dx;
    suppressClick.current = true;
    const w = wrap.current?.offsetWidth || 360;
    const eased = dx / (1 + Math.abs(dx) / (w * 1.4)); // light rubber band
    page.current.style.transform = `translateX(${eased}px) rotateY(${(-eased / w) * 12}deg)`;
    page.current.style.opacity = String(1 - Math.min(0.35, Math.abs(eased) / w / 1.5));
  };

  const onUp = (e: React.PointerEvent) => {
    const s = g.current;
    g.current = null;
    if (!s || s.axis !== 'x' || !page.current) return;
    const w = wrap.current?.offsetWidth || 360;
    const v = s.dx / Math.max(1, performance.now() - s.t);
    const el = page.current;
    const cur = s.dx / (1 + Math.abs(s.dx) / (w * 1.4));
    if (Math.abs(s.dx) > w * 0.2 || Math.abs(v) > 0.45) {
      go(s.dx < 0 ? 1 : -1, cur);
    } else {
      el.animate(
        [{ transform: el.style.transform, opacity: el.style.opacity || '1' }, { transform: 'translateX(0)', opacity: 1 }],
        { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
      el.style.transform = '';
      el.style.opacity = '';
    }
    void e;
  };

  return (
    <div
      ref={wrap}
      className="pager"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          e.stopPropagation();
          e.preventDefault();
          suppressClick.current = false;
        }
      }}
    >
      <div ref={page} className="pager-page">{children}</div>
    </div>
  );
}
