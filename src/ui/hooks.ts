import { useEffect, useMemo, useState } from 'react';
import { msToZoned } from '../core/dates';
import { effectiveZone, useStore, liveReminders } from '../state/store';
import type { Reminder } from '../core/types';

/** Current zone + "today" in that zone; re-renders every 30 s and on focus. */
export function useClock() {
  const settings = useStore((s) => s.settings);
  const zone = effectiveZone(settings);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 30_000);
    const vis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);
  const local = msToZoned(now, zone);
  return { now, zone, today: local.date, time: local.time };
}

export function useReminders(): Reminder[] {
  const map = useStore((s) => s.reminders);
  return useMemo(() => liveReminders(), [map]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Apply light/dark theme to <html>. */
export function useTheme() {
  const theme = useStore((s) => s.settings.theme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      const meta = document.querySelector('meta[name="theme-color"]:not([media])') || (() => {
        const m = document.createElement('meta');
        m.name = 'theme-color';
        document.head.appendChild(m);
        return m;
      })();
      meta.setAttribute('content', dark ? '#0e0e10' : '#f5f4f0');
    };
    apply();
    try {
      localStorage.setItem('rem:theme', theme);
    } catch {
      /* ignore */
    }
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, [theme]);
}

export function greetingFor(time: string, g: { morning: string; day: string; evening: string }): string {
  const h = Number(time.slice(0, 2));
  if (h >= 5 && h < 12) return g.morning;
  if (h >= 12 && h < 18) return g.day;
  return g.evening;
}
