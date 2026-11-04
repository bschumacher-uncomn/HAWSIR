import { useEffect, useState } from 'react';

/** Seconds since page load, updated at ~30 fps for layer animation. */
export function usePulse() {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      if (now - last > 33) {
        setT(now / 1000);
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return t;
}
