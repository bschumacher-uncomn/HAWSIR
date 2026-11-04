// Injected before any page script runs. Replaces the page's clocks with one that only moves
// when the capture script calls window.__vt.advance(ms), and slaves CSS/WAAPI and SMIL
// animations to it, so each captured frame is exactly 1/30 s after the last.
export const VIRTUAL_TIME = `(() => {
  const realNow = performance.now.bind(performance);
  const realDate = Date.now;
  let vnow = realNow();
  const dateBase = realDate() - vnow;
  const timers = new Map();
  const rafs = new Map();
  let nextTimer = 1e7;
  let nextRaf = 1e7;
  const animStart = new WeakMap();
  const svgStart = new WeakMap();

  performance.now = () => vnow;
  Date.now = () => Math.round(dateBase + vnow);
  window.setTimeout = (fn, ms = 0, ...args) => {
    const id = nextTimer++;
    timers.set(id, { fn, args, at: vnow + Math.max(0, Number(ms) || 0), every: 0 });
    return id;
  };
  window.setInterval = (fn, ms = 0, ...args) => {
    const every = Math.max(1, Number(ms) || 0);
    const id = nextTimer++;
    timers.set(id, { fn, args, at: vnow + every, every });
    return id;
  };
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);
  window.requestAnimationFrame = (cb) => {
    const id = nextRaf++;
    rafs.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => rafs.delete(id);

  function syncAnimations() {
    for (const a of document.getAnimations()) {
      let start = animStart.get(a);
      if (start === undefined) {
        start = vnow - (a.currentTime ?? 0);
        animStart.set(a, start);
      }
      const t = vnow - start;
      const end = a.effect?.getComputedTiming?.().endTime;
      if (Number.isFinite(end) && t >= end) {
        if (a.playState !== 'finished') try { a.finish(); } catch {}
        continue;
      }
      if (a.playState !== 'paused') a.pause();
      a.currentTime = Math.max(0, t);
    }
    for (const svg of document.querySelectorAll('svg')) {
      if (!svg.querySelector('animate, animateMotion, animateTransform')) continue;
      let start = svgStart.get(svg);
      if (start === undefined) {
        start = vnow - svg.getCurrentTime() * 1000;
        svgStart.set(svg, start);
        svg.pauseAnimations();
      }
      svg.setCurrentTime((vnow - start) / 1000);
    }
  }

  window.__vt = {
    get now() { return vnow; },
    advance(dt) {
      const target = vnow + dt;
      for (let guard = 0; guard < 5000; guard++) {
        let next;
        for (const entry of timers) if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) next = entry;
        if (!next) break;
        const [id, t] = next;
        vnow = Math.max(vnow, t.at);
        if (t.every) t.at += t.every;
        else timers.delete(id);
        try { typeof t.fn === 'function' ? t.fn(...t.args) : (0, eval)(t.fn); } catch (e) { console.error(e); }
      }
      vnow = target;
      const due = [...rafs.values()];
      rafs.clear();
      for (const cb of due) try { cb(vnow); } catch (e) { console.error(e); }
      syncAnimations();
    },
  };
})();`;
