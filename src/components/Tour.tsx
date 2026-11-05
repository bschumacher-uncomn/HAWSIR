import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { useEngine } from '@/state/engine';
import { useStore } from '@/state/store';

interface Step {
  to: string;
  title: string;
  caption: string;
  ms: number;
  /** Replays the change stream; the step ends when playback does (or at `ms`). */
  replay?: boolean;
  speed?: number;
  scenario?: string;
}

const REPLAY_SPEED = 24;

const STEPS: Step[] = [
  { to: '/', scenario: 'atlas-shield', title: 'Watch floor', caption: 'A destroyer 21 days from tasking. Each report lands on the node and the picture is recomputed: the CASREP, the part slip past sail, the technicians on leave.', ms: 120_000, replay: true },
  { to: '/', title: 'Five answers, one screen', caption: 'What changed, what it affects, what controls readiness, margin and certainty, and bounded options. AMD is Q, and FC1 Martinez controls it.', ms: 10_000 },
  { to: '/thread', title: 'Executable mission thread', caption: 'The same dependency graph as lanes and handoffs: who is waiting on whom, and what the plan of record looked like at watch start.', ms: 11_000 },
  { to: '/graph', title: 'Consequence graph', caption: 'The critical chain from feeds to capability, with upstream slack and mission margin on every node. Drag a what-if; nothing is recorded.', ms: 9_000 },
  { to: '/theater', scenario: 'steel-tide', title: 'Theater', caption: 'A carrier strike group: every ship moving at once, and every part and person feeding readiness, on an offline basemap.', ms: 12_000 },
  { to: '/lab', title: 'Fleet lab', caption: 'Thirty-eight hulls, twelve missions. Close Suez, ground AMC, take NSIPS down: the consequence is computed, not looked up.', ms: 12_000 },
  { to: '/log', title: 'Tamper-evident record', caption: 'Every report and every human decision on SHA-256 hash chains, re-verified in this browser. Planning assumptions, never orders.', ms: 8_000 },
  { to: '/edge', title: 'Edge platform', caption: 'One mission-api per node, ship and shore, syncing when the link allows and computing when it does not.', ms: 9_000 },
];

export const useTour = create<{ on: boolean; start: () => void; stop: () => void }>()((set) => ({
  on: false,
  start: () => set({ on: true }),
  stop: () => set({ on: false }),
}));

function enterStep(step: Step, first: boolean) {
  const st = useStore.getState();
  if (step.scenario && st.scenarioId !== step.scenario) st.setScenario(step.scenario);
  void first;
  if (step.replay) {
    st.focusEvent(null);
    // the player restarts from the watch start when asked to play at the end of the watch
    st.setWatchTime(Number.NaN);
    st.setSpeed(step.speed ?? REPLAY_SPEED);
    st.setPlaying(true);
  }
}

export function Tour() {
  const { on, start, stop } = useTour();
  const navigate = useNavigate();
  const navRef = useRef(navigate);
  navRef.current = navigate;
  const halted = useEngine().halted.stopped;
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
