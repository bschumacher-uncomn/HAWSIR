import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { scenarioById } from '@/data/scenarios';
import { useStore } from '@/state/store';

interface Step {
  to: string;
  title: string;
  caption: string;
  ms: number;
  /** Replays the change stream; the step ends when playback does (or at `ms`). */
  replay?: boolean;
}

const TOUR_SCENARIO = 'ddg21';
const REPLAY_SPEED = 24;

const STEPS: Step[] = [
  { to: '/', title: 'Watch floor', caption: 'Each feed change is recomputed on the edge node. Watch the change stream: the CASREP lands, the part slips, the technicians leave.', ms: 120_000, replay: true },
  { to: '/', title: 'Five answers, one screen', caption: 'What changed, what it affects, what controls readiness, margin and certainty, and bounded options. AMD is Q, and FC1 Martinez controls it.', ms: 10_000 },
  { to: '/graph', title: 'Consequence graph', caption: 'The critical chain from feeds to capability, with upstream slack and mission margin on every node.', ms: 9_000 },
  { to: '/horizon', title: 'Readiness horizon', caption: 'Know before it breaks the mission: projected readiness against each phase, and every act-by deadline.', ms: 9_000 },
  { to: '/sim', title: '2,000 futures', caption: 'Seeded Monte Carlo: the chance each capability is ready in time, and what controls it across futures.', ms: 10_000 },
  { to: '/theater', title: 'Theater', caption: 'Every part, person and aircraft feeding readiness, and the delivery windows they have to hit.', ms: 9_000 },
  { to: '/log', title: 'Tamper-evident log', caption: 'Every ingest and human decision on a SHA-256 hash chain, mirrored to the edge node. Planning assumptions, never orders.', ms: 8_000 },
  { to: '/edge', title: 'Edge platform', caption: 'RHEL 9, RKE2 and UDS Core. One Zarf bundle per hull, AI-assisted CI/CD with a human gate, runs disconnected.', ms: 9_000 },
  { to: '/evidence', title: 'Evidence', caption: 'Twelve failure cases run live, baseline vs assisted, limitations and the 30/60/90 plan.', ms: 9_000 },
];

export const useTour = create<{ on: boolean; start: () => void; stop: () => void }>()((set) => ({
  on: false,
  start: () => set({ on: true }),
  stop: () => set({ on: false }),
}));

function enterStep(step: Step, first: boolean) {
  const st = useStore.getState();
  if (first) {
    if (st.scenarioId !== TOUR_SCENARIO) st.setScenario(TOUR_SCENARIO);
    st.resetSession();
  }
  if (step.replay) {
    const s = scenarioById(TOUR_SCENARIO);
    st.focusEvent(null);
    st.setWatchTime(s.watchStart - 1);
    st.setSpeed(REPLAY_SPEED);
    st.setPlaying(true);
  }
}

export function Tour() {
  const { on, start, stop } = useTour();
  const navigate = useNavigate();
  const navRef = useRef(navigate);
  navRef.current = navigate;
  const halted = useStore((s) => s.halted);
  const [idx, setIdx] = useState(0);
  const step = STEPS[idx];

  useEffect(() => {
    if (new URLSearchParams(location.search).has('tour')) start();
  }, [start]);

  useEffect(() => {
    if (halted) stop();
  }, [halted, stop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useTour.getState().on) {
        e.preventDefault();
        e.stopImmediatePropagation();
        stop();
        useStore.getState().setPlaying(false);
        return;
      }
      if (e.key === 't' && !e.metaKey && !e.ctrlKey && !e.altKey && !(e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) start();
    };
    const onPointer = () => {
      if (!useTour.getState().on) return;
      stop();
      useStore.getState().setPlaying(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [start, stop]);

  useEffect(() => {
    if (!on) {
      setIdx(0);
      return;
    }
    enterStep(step, idx === 0);
    navRef.current(step.to + location.search);
    const began = performance.now();
    const id = setInterval(() => {
      const elapsed = performance.now() - began;
      const replayDone = step.replay && elapsed > 4000 && !useStore.getState().playing;
      if (elapsed >= step.ms || replayDone) setIdx((i) => (i + 1) % STEPS.length);
    }, 250);
    return () => {
      clearInterval(id);
      if (step.replay) useStore.getState().setPlaying(false);
    };
  }, [on, idx, step]);

  return (
    <AnimatePresence>
      {on && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="pointer-events-none fixed bottom-10 right-6 z-[95] w-[440px]"
        >
          <div className="hud overflow-hidden px-4 py-3" style={{ borderColor: '#22d3ee88', boxShadow: '0 0 50px -12px #22d3ee, inset 0 0 30px #22d3ee12' }}>
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-calc shadow-[0_0_8px_#22d3ee]" />
              <span className="label !text-[9px] !text-calc/80">Attract mode · {idx + 1}/{STEPS.length}</span>
              <span className="ml-auto font-mono text-[9px] text-mute">any key to take the watch</span>
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={idx} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.25 }}>
                <div className="mt-1.5 font-display text-[16px] font-bold uppercase tracking-[0.16em] text-white">{step.title}</div>
                <div className="mt-1 text-[12.5px] leading-snug text-sky-100/80">{step.caption}</div>
              </motion.div>
            </AnimatePresence>
            <div className="mt-2.5 flex gap-1">
              {STEPS.map((s, i) => (
                <div key={s.title} className="h-[3px] flex-1 overflow-hidden rounded bg-white/10">
                  {i < idx && <div className="h-full w-full bg-calc/60" />}
                  {i === idx && (
                    <motion.div
                      key={idx}
                      className="h-full bg-calc shadow-[0_0_8px_#22d3ee]"
                      initial={{ width: '0%' }}
                      animate={{ width: '100%' }}
                      transition={{ duration: (s.replay ? 36_000 : s.ms) / 1000, ease: 'linear' }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
