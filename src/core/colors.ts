import type { ColorKey } from './types';

export interface PastelColor {
  key: ColorKey;
  name: string;
  hint: string;
  /** card background (light / dark) */
  bg: string;
  bgDark: string;
  /** accent for checkbox, time, small details (light / dark) */
  accent: string;
  accentDark: string;
}

export const COLORS: PastelColor[] = [
  { key: 'sky', name: 'Голубой', hint: 'Учёба', bg: '#E4EEFB', bgDark: '#1C2635', accent: '#4F86D9', accentDark: '#8DB6F2' },
  { key: 'lavender', name: 'Лавандовый', hint: 'Личное', bg: '#ECE7FA', bgDark: '#262236', accent: '#8467D2', accentDark: '#B6A2F0' },
  { key: 'mint', name: 'Мятный', hint: 'Здоровье', bg: '#DEF3EE', bgDark: '#17302B', accent: '#2E9C84', accentDark: '#7ED3BF' },
  { key: 'green', name: 'Зелёный', hint: 'Спорт', bg: '#E6F2DE', bgDark: '#1F2D1A', accent: '#5B9A42', accentDark: '#A3D38C' },
  { key: 'peach', name: 'Персиковый', hint: 'Важное', bg: '#FCE8DC', bgDark: '#36251C', accent: '#D9784A', accentDark: '#F2AE8A' },
  { key: 'yellow', name: 'Жёлтый', hint: 'Покупки', bg: '#FBF2D3', bgDark: '#332C17', accent: '#B98E14', accentDark: '#E9C766' },
  { key: 'pink', name: 'Розовый', hint: 'Дни рождения', bg: '#FBE4EB', bgDark: '#36202A', accent: '#D46489', accentDark: '#F2A3BD' },
];

export const COLOR_KEYS = COLORS.map((c) => c.key);

export function colorOf(key: ColorKey | string | undefined): PastelColor {
  return COLORS.find((c) => c.key === key) ?? COLORS[0];
}

/** CSS custom properties for a colored element. */
export function colorVars(key: ColorKey | string): Record<string, string> {
  const c = colorOf(key);
  return { '--c-bg': c.bg, '--c-bg-d': c.bgDark, '--c-ac': c.accent, '--c-ac-d': c.accentDark };
}
