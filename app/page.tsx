'use client';
import dynamic from 'next/dynamic';

// The app is fully client-side (local-first data in IndexedDB), so skip SSR.
const App = dynamic(() => import('../src/ui/App'), {
  ssr: false,
  loading: () => (
    <div className="splash">
      <div className="splash-dot" />
    </div>
  ),
});

export default function Page() {
  return <App />;
}
