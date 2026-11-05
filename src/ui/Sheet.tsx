'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

let locks = 0;
function lockScroll(on: boolean) {
  locks += on ? 1 : -1;
  document.documentElement.style.overflow = locks > 0 ? 'hidden' : '';
}

/** Mount/unmount with enter/exit transitions. */
export function usePresence(open: boolean, ms = 420) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [open, ms]);
  return { mounted, shown };
}

interface Props {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  tall?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  label?: string;
  z?: number;
}

export function Sheet({ open, onClose, title, left, right, tall, children, footer, label, z = 0 }: Props) {
  const { mounted, shown } = usePresence(open);
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!mounted) return;
    lockScroll(true);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    return () => {
      lockScroll(false);
      window.removeEventListener('keydown', onKey);
    };
  }, [mounted]);

  if (!mounted) return null;

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, textarea')) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    sheetRef.current?.classList.add('dragging');
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !sheetRef.current) return;
    const dy = Math.max(0, e.clientY - drag.current.y);
    drag.current.dy = dy;
    sheetRef.current.style.transform = `translate(-50%, ${dy}px)`;
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    const el = sheetRef.current;
    if (!d || !el) return;
    el.classList.remove('dragging');
    el.style.transform = '';
    const v = d.dy / Math.max(1, performance.now() - d.t);
    if (d.dy > 120 || (d.dy > 30 && v > 0.6)) onClose();
  };

  const dragProps = { onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp };

  return (
    <>
      <div className={`scrim ${shown ? 'open' : ''}`} style={{ zIndex: 50 + z * 2 }} onClick={onClose} />
      <div
        ref={sheetRef}
        className={`sheet ${shown ? 'open' : ''} ${tall ? 'tall' : ''}`}
        style={{ zIndex: 51 + z * 2 }}
        role="dialog"
        aria-modal="true"
        aria-label={label || (typeof title === 'string' ? title : undefined)}
      >
        <div className="grabber" {...dragProps}><i /></div>
        {(title || left || right) && (
          <div className="sheet-head" {...dragProps}>
            <div style={{ minWidth: 72 }}>{left}</div>
            <div className="sheet-title">{title}</div>
            <div style={{ minWidth: 72, display: 'flex', justifyContent: 'flex-end' }}>{right}</div>
          </div>
        )}
        <div className="sheet-body">{children}</div>
        {footer}
      </div>
    </>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}
