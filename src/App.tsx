import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { api } from './api/client';
import type { MissionSummary } from './api/types';
import { BRAND } from './brand';
import { Boot } from './components/Boot';
import { Layout, ScreenBoundary } from './components/Shell';
import { EngineProvider } from './state/engine';
import { useStore } from './state/store';
import { WatchFloor } from './routes/WatchFloor';

const FleetLab = lazy(() => import('./labs/fleet/FleetRoute'));
const MissionThread = lazy(() => import('./routes/MissionThread'));
const GraphView = lazy(() => import('./routes/GraphView'));
const Theater = lazy(() => import('./routes/Theater'));
const DecisionLog = lazy(() => import('./routes/DecisionLog'));
const EdgePlatform = lazy(() => import('./routes/EdgePlatform'));

function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <span className="label animate-blink !text-calc">Loading module…</span>
    </div>
  );
}

function Screens() {
  const loc = useLocation();
  const scenarioId = useStore((s) => s.scenarioId);
  return (
    <ScreenBoundary resetKey={`${loc.pathname}|${scenarioId}`}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<WatchFloor />} />
          <Route path="/thread" element={<MissionThread />} />
          <Route path="/lab" element={<FleetLab />} />
          <Route path="/labs/fleet" element={<Navigate to={`/lab${location.search}`} replace />} />
          <Route path="/graph" element={<GraphView />} />
          <Route path="/theater" element={<Theater />} />
          <Route path="/log" element={<DecisionLog />} />
          <Route path="/edge" element={<EdgePlatform />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ScreenBoundary>
  );
}

export function App() {
  const booted = useStore((s) => s.booted);
  const setBooted = useStore((s) => s.setBooted);

  useEffect(() => {
    document.title = `${BRAND.name} · ${BRAND.tagline}`;
    const q = new URLSearchParams(location.search);
    if (q.has('noboot') || (!q.has('boot') && sessionStorage.getItem(`${BRAND.slug}-booted`))) setBooted(true);
    const st = useStore.getState();
    // a mission the node does not serve (stale bookmark, renamed scenario) falls back to the first one it does
    api
      .get<{ missions: MissionSummary[] }>('/missions')
      .then(({ missions }) => {
        const want = q.get('scenario') ?? st.scenarioId;
        const id = missions.some((m) => m.id === want) ? want : missions[0]?.id;
        if (id && id !== st.scenarioId) st.setScenario(id);
        if (q.get('cap')) st.selectCap(q.get('cap')!);
        if (q.get('node')) st.selectNode(q.get('node'));
        if (q.get('t') && Number.isFinite(Number(q.get('t')))) st.setWatchTime(Number(q.get('t')));
      })
      .catch(() => undefined);
  }, [setBooted]);

  return (
    <BrowserRouter>
      <EngineProvider>
        {!booted ? (
          <Boot />
        ) : (
          <Layout>
            <Screens />
          </Layout>
        )}
      </EngineProvider>
      <Toaster theme="dark" position="bottom-right" toastOptions={{ style: { background: '#06111d', border: '1px solid rgba(34,211,238,0.3)', color: '#cfe8f5', fontFamily: 'JetBrains Mono Variable' } }} />
    </BrowserRouter>
  );
}
