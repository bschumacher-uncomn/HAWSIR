import { useEffect, useState } from 'react';

export function Typewriter({ text, cps = 140, className }: { text: string; cps?: number; className?: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const k = Math.min(text.length, Math.floor(((now - start) / 1000) * cps));
      setN(k);
      if (k < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, cps]);
  return (
    <span className={className}>
      {text.slice(0, n)}
      {n < text.length && <span className="ml-px inline-block h-3 w-1.5 translate-y-0.5 animate-blink bg-current" />}
    </span>
  );
}
