import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Boot } from './components/Boot';
import { Layout } from './components/Shell';
import { EngineProvider } from './state/engine';
import { useStore } from './state/store';
import { WatchFloor } from './routes/WatchFloor';

const GraphView = lazy(() => import('./routes/GraphView'));
const Horizon = lazy(() => import('./routes/Horizon'));
const Simulate = lazy(() => import('./routes/Simulate'));
const Theater = lazy(() => import('./routes/Theater'));
const DecisionLog = lazy(() => import('./routes/DecisionLog'));
const Evidence = lazy(() => import('./routes/Evidence'));
const EdgePlatform = lazy(() => import('./routes/EdgePlatform'));

function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <span className="label animate-blink !text-calc">Loading module…</span>
    </div>
  );
}

function useShoreSync() {
  const link = useStore((s) => s.link);
  const mark = useStore((s) => s.markShoreSynced);
  useEffect(() => {
    if (link === 'DENIED') return;
    const id = setInterval(() => mark(link === 'SATCOM' ? 50 : 1), link === 'SATCOM' ? 1200 : 3500);
    return () => clearInterval(id);
  }, [link, mark]);
}

export function App() {
  const booted = useStore((s) => s.booted);
  const setBooted = useStore((s) => s.setBooted);
  useShoreSync();

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.has('noboot') || (!q.has('boot') && sessionStorage.getItem('navifi-booted'))) setBooted(true);
    const st = useStore.getState();
    if (q.has('reset')) {
      st.resetSession();
      q.delete('reset');
      const rest = q.toString();
      history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : ''));
    }
    if (q.get('cap')) st.selectCap(q.get('cap')!);
    if (q.get('node')) st.selectNode(q.get('node'));
    if (q.get('t') && Number.isFinite(Number(q.get('t')))) st.setWatchTime(Number(q.get('t')));
  }, [setBooted]);

  return (
    <BrowserRouter>
      <EngineProvider>
        {!booted ? (
          <Boot />
        ) : (
          <Layout>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/" element={<WatchFloor />} />
                <Route path="/graph" element={<GraphView />} />
                <Route path="/horizon" element={<Horizon />} />
                <Route path="/sim" element={<Simulate />} />
                <Route path="/theater" element={<Theater />} />
                <Route path="/log" element={<DecisionLog />} />
                <Route path="/evidence" element={<Evidence />} />
                <Route path="/edge" element={<EdgePlatform />} />
              </Routes>
            </Suspense>
          </Layout>
        )}
        <Toaster theme="dark" position="bottom-right" toastOptions={{ style: { background: '#06111d', border: '1px solid rgba(34,211,238,0.3)', color: '#cfe8f5', fontFamily: 'JetBrains Mono Variable' } }} />
      </EngineProvider>
    </BrowserRouter>
  );
}
