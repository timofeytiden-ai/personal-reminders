import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Напоминания',
  description: 'Личный центр напоминаний',
  manifest: '/manifest.webmanifest',
  applicationName: 'Напоминания',
  appleWebApp: { capable: true, title: 'Напоминания', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f4f0' },
    { media: '(prefers-color-scheme: dark)', color: '#0e0e10' },
  ],
};

// Applies the saved theme before first paint (no flash).
const themeScript = `(function(){try{var t=localStorage.getItem('rem:theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body>{children}</body>
    </html>
  );
}
