import type { ReactNode } from 'react';

interface P {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

function I({ size = 22, className, strokeWidth = 1.9, children }: P & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Plus = (p: P) => <I {...p}><path d="M12 5v14M5 12h14" /></I>;
export const Check = (p: P) => <I {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></I>;
export const X = (p: P) => <I {...p}><path d="M6 6l12 12M18 6L6 18" /></I>;
export const ChevronLeft = (p: P) => <I {...p}><path d="M15 5l-7 7 7 7" /></I>;
export const ChevronRight = (p: P) => <I {...p}><path d="M9 5l7 7-7 7" /></I>;
export const ChevronDown = (p: P) => <I {...p}><path d="M6 9l6 6 6-6" /></I>;
export const Calendar = (p: P) => (
  <I {...p}><rect x="3.5" y="5" width="17" height="15.5" rx="4" /><path d="M3.5 10h17M8 3v4M16 3v4" /></I>
);
export const Clock = (p: P) => <I {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></I>;
export const Repeat = (p: P) => (
  <I {...p}><path d="M17 2.5l3 3-3 3" /><path d="M4 11.5v-1a5 5 0 015-5h11" /><path d="M7 21.5l-3-3 3-3" /><path d="M20 12.5v1a5 5 0 01-5 5H4" /></I>
);
export const Globe = (p: P) => (
  <I {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5s1.1-5.9 3.6-8.5z" /></I>
);
export const Pause = (p: P) => <I {...p}><path d="M9 6v12M15 6v12" /></I>;
export const Play = (p: P) => <I {...p}><path d="M8 5.5v13l10-6.5z" /></I>;
export const Trash = (p: P) => (
  <I {...p}><path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 002 1.8h7a2 2 0 002-1.8l1-12M9 7V4.5h6V7" /></I>
);
export const Pencil = (p: P) => <I {...p}><path d="M14.5 5.5l4 4M4 20l1-4.5L16 4.5a1.4 1.4 0 012 0l1.5 1.5a1.4 1.4 0 010 2L8.5 19z" /></I>;
export const ArrowForward = (p: P) => <I {...p}><path d="M4 12h15M13 6l6 6-6 6" /></I>;
export const Sliders = (p: P) => (
  <I {...p}><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2.2" /><circle cx="9" cy="17" r="2.2" /></I>
);
export const Sparkles = (p: P) => (
  <I {...p}><path d="M11 3.5l1.6 4.4L17 9.5l-4.4 1.6L11 15.5l-1.6-4.4L5 9.5l4.4-1.6z" /><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" /></I>
);
export const Send = (p: P) => <I {...p}><path d="M12 19V5M6 11l6-6 6 6" /></I>;
export const Bell = (p: P) => (
  <I {...p}><path d="M6 16.5V11a6 6 0 0112 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2.2 2.2 0 004 0" /></I>
);
export const Sun = (p: P) => (
  <I {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></I>
);
export const Moon = (p: P) => <I {...p}><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" /></I>;
export const Monitor = (p: P) => <I {...p}><rect x="3" y="4.5" width="18" height="12" rx="2.5" /><path d="M9 20h6M12 16.5V20" /></I>;
export const Sunrise = (p: P) => <I {...p}><path d="M4 18h16M7 18a5 5 0 0110 0M12 5v4M5 10l1.5 1.5M19 10l-1.5 1.5M9.5 7L12 4.5 14.5 7" /></I>;
export const Inbox = (p: P) => (
  <I {...p}><path d="M3.5 13.5l2.5-8h12l2.5 8v5a2 2 0 01-2 2h-13a2 2 0 01-2-2z" /><path d="M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5" /></I>
);
export const ListIcon = (p: P) => <I {...p}><path d="M9 6.5h11M9 12h11M9 17.5h11" /><circle cx="4.5" cy="6.5" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="17.5" r="1" /></I>;
export const CheckCircle = (p: P) => <I {...p}><circle cx="12" cy="12" r="8.5" /><path d="M8.3 12.3l2.5 2.5 5-5.2" /></I>;
export const Today = (p: P) => (
  <I {...p}><rect x="3.5" y="5" width="17" height="15.5" rx="4" /><path d="M3.5 10h17M8 3v4M16 3v4" /><circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none" /></I>
);
export const Search = (p: P) => <I {...p}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></I>;
export const Cloud = (p: P) => <I {...p}><path d="M7 18.5a4.5 4.5 0 01-.6-9 6 6 0 0111.4 1.6A3.8 3.8 0 0117.5 18.5z" /></I>;
export const Download = (p: P) => <I {...p}><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" /></I>;
export const Upload = (p: P) => <I {...p}><path d="M12 15.5V4.5M7 9l5-5 5 5M5 20h14" /></I>;
export const Share = (p: P) => <I {...p}><path d="M12 3.5v12M8 7.5l4-4 4 4" /><path d="M7 11H5.5v9.5h13V11H17" /></I>;
export const User = (p: P) => <I {...p}><circle cx="12" cy="8.5" r="4" /><path d="M4.5 20.5a7.5 7.5 0 0115 0" /></I>;
export const Undo = (p: P) => <I {...p}><path d="M9 14.5l-5-5 5-5" /><path d="M4 9.5h10a6 6 0 010 12h-2" /></I>;
export const Volume = (p: P) => <I {...p}><path d="M4 9.5v5h3.5l5 4v-13l-5 4z" /><path d="M16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11" /></I>;
export const Info = (p: P) => <I {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8v.2" /></I>;
