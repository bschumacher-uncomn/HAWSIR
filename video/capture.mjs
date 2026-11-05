// Captures NAVIFI footage for the hype cut: 4K stills plus frame-exact 30 fps clips.
// Clips run the real app on a virtual clock (timers, rAF, CSS/WAAPI and SMIL animations),
// so software rendering speed never shows up as dropped frames.
// usage: node video/capture.mjs [only,names]   (dev server on :5310)
import { mkdir, rm, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { VIRTUAL_TIME } from './virtual-time.mjs';

const BASE = process.env.BASE ?? 'http://localhost:5310';
const OUT = new URL('./footage/', import.meta.url).pathname;
const FPS = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = (js) => `(() => { const s = window.__navifi.getState(); ${js} })()`;
const click = (re) => `[...document.querySelectorAll('button')].find((b) => ${re}.test(b.textContent))?.click()`;
const APPROVE = click('/^\\s*approve\\s*$/i');
const CONFIRM = click('/confirm approval/i');
const MISSION_ROW = `[...document.querySelectorAll('button')].find((b) => /T-\\d/.test(b.textContent))?.click()`;
/** Drags the globe until a mission's label sits mid-screen (headless frames are too slow for the auto-spin to get there). */
const globeCenterOn = (re) => async (page) => {
  const offset = `(() => {
    const label = [...document.querySelectorAll('.inset-0 > div[style*="translate"]')].find((d) => ${re}.test(d.textContent));
    if (!label || +label.style.opacity < 0.5) return null;
    const r = label.getBoundingClientRect();
    return r.left + r.width / 2 - innerWidth / 2;
  })()`;
  const grab = `[[960, 620], [900, 720], [1020, 470], [960, 800]].find(([x, y]) => document.elementFromPoint(x, y)?.tagName === 'CANVAS')`;
  for (let i = 0; i < 24; i++) {
    const dx = await page.evaluate(offset);
    if (dx !== null && Math.abs(dx) < 20) return;
    const [x, y] = (await page.evaluate(grab)) ?? [960, 620];
    const move = dx === null ? -280 : Math.max(-280, Math.min(280, -dx * 0.9));
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let k = 1; k <= 12; k++) await page.mouse.move(x + (move * k) / 12, y, { steps: 2 });
    await page.mouse.up();
    await sleep(500);
  }
  throw new Error(`globe never centred on ${re}`);
};

/** Stills are 3840×2160 so the cut can push in without going soft. */
const STILLS = [
  { name: 'thread_0600', route: '/thread?scenario=mcm&reset' },
  { name: 'thread_1000', route: '/thread?scenario=mcm&reset&t=10' },
  { name: 'thread_approved', route: '/thread?scenario=mcm&reset&t=10', steps: [APPROVE, 700, CONFIRM, 3200] },
  { name: 'thread_ddg', route: '/thread?scenario=ddg21&reset' },
  { name: 'thread_vls', route: '/thread?scenario=reload72&reset' },
  { name: 'thread_radar', route: '/thread?scenario=classic&reset' },
  { name: 'watch_mcm', route: '/?scenario=mcm&reset&t=10', wait: 7000 },
  { name: 'graph_mcm', route: '/graph?scenario=mcm&reset&t=10', wait: 6000 },
  { name: 'graph_ddg', route: '/graph?scenario=ddg21&reset', wait: 6000, steps: [store("s.selectNode('p_fc1_martinez')"), 2000] },
  { name: 'edge_emcon', route: '/edge?scenario=mcm&reset', steps: [store("s.setLink('DENIED')"), 2500] },
  { name: 'evidence', route: '/evidence?scenario=mcm&reset', wait: 7000 },
  { name: 'log', route: '/log?scenario=mcm&reset&t=10', wait: 5000 },
  { name: 'fleet_globe', route: '/labs/fleet', wait: 9000 },
  { name: 'fleet_mission', route: '/labs/fleet', wait: 5000, steps: [MISSION_ROW, 3500] },
  {
    name: 'fleet_whatif', route: '/labs/fleet', wait: 5000,
    steps: [click('/Suez Canal closed/'), 500, click('/Typhoon/'), 500, click('/AMC airlift/'), 3000],
  },
  {
    name: 'fleet_pacific', route: '/labs/fleet', wait: 5000,
    steps: [click('/Typhoon/'), 500, click('/NSIPS outage/'), 1000, globeCenterOn('/KEEN EDGE 27/'), 1500],
  },
  { name: 'sim_mcm', route: '/sim?scenario=mcm&reset&t=10', wait: 10000 },
  { name: 'sim_ddg', route: '/sim?scenario=ddg21&reset', wait: 10000 },
  { name: 'sim_vls', route: '/sim?scenario=reload72&reset', wait: 10000 },
  { name: 'sim_radar', route: '/sim?scenario=classic&reset', wait: 10000 },
  { name: 'horizon_mcm', route: '/horizon?scenario=mcm&reset&t=10', wait: 7000 },
  { name: 'horizon_ddg', route: '/horizon?scenario=ddg21&reset', wait: 7000 },
  { name: 'theater_mcm', route: '/theater?scenario=mcm&reset&t=10', wait: 8000 },
  { name: 'theater_ddg', route: '/theater?scenario=ddg21&reset', wait: 8000 },
];

/**
 * Clips: `setup` runs before recording; `at` entries fire at virtual seconds into the clip;
 * `tick` runs every frame.
 */
const CLIPS = [
  { name: 'boot', route: '/?scenario=mcm&reset', boot: true, secs: 7, lead: 0.2 },
  { name: 'run_thread', route: '/thread?scenario=mcm&reset', secs: 14, at: [[0.4, click('/RUN THREAD/')]] },
  {
    name: 'reports_land', route: '/thread?scenario=mcm&reset', secs: 15,
    at: [[0.3, store('s.setWatchTime(5.9); s.setSpeed(12); s.setPlaying(true)')]],
    tick: store('if (s.watchTime > 10.01 && s.playing) s.setPlaying(false)'),
  },
  { name: 'approve', route: '/thread?scenario=mcm&reset&t=10', secs: 7, at: [[0.8, APPROVE], [2.2, CONFIRM]] },
  { name: 'thread_switch', route: '/thread?scenario=mcm&reset', secs: 10, at: [[1.2, click('/DDG READINESS/i')], [3.7, click('/VLS RELOAD/i')], [6.2, click('/RADAR REPAIR/i')]] },
  {
    name: 'watch_feed', route: '/?scenario=mcm&reset', secs: 13,
    at: [[0.3, store('s.setWatchTime(5.9); s.setSpeed(12); s.setPlaying(true)')]],
    tick: store('if (s.watchTime > 10.01 && s.playing) s.setPlaying(false)'),
  },
  { name: 'emcon', route: '/edge?scenario=mcm&reset', secs: 7, at: [[1.0, store("s.setLink('DDIL')")], [2.8, store("s.setLink('DENIED')")]] },
  {
    name: 'tamper', route: '/log?scenario=mcm&reset', lead: 18, secs: 9,
    setup: store('s.setWatchTime(5.9); s.setSpeed(48); s.setPlaying(true)'),
    at: [[0.6, click('/Verify chain/')], [2.8, click('/Simulate tamper/')], [5.6, click('/Restore from edge copy/')]],
  },
];

const only = process.argv[2]?.split(',');
// hardware GL through EGL is ~8x faster per frame than SwiftShader and keeps WebGL
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  userDataDir: '/tmp/navifi-video-profile',
  args: ['--no-sandbox', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--hide-scrollbars', '--password-store=basic'],
});
const url = (route, boot) => `${BASE}${route}${boot ? '' : `${route.includes('?') ? '&' : '?'}noboot`}`;

await mkdir(`${OUT}stills`, { recursive: true });
for (const s of STILLS) {
  if (only && !only.includes(s.name)) continue;
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
  await page.goto(url(s.route), { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(s.wait ?? 5000);
  for (const step of s.steps ?? []) {
    if (typeof step === 'number') await sleep(step);
    else if (typeof step === 'function') await step(page);
    else await page.evaluate(step);
  }
  await page.screenshot({ path: `${OUT}stills/${s.name}.png`, type: 'png' });
  await page.close();
  console.log('still', s.name);
}

for (const c of CLIPS) {
  if (only && !only.includes(c.name)) continue;
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(VIRTUAL_TIME);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url(c.route, c.boot), { waitUntil: 'domcontentloaded', timeout: 60000 });
  const step = () => page.evaluate((dt) => window.__vt.advance(dt), 1000 / FPS);
  const cdp = await page.createCDPSession();

  // settle on the virtual clock so the screen is fully up before recording
  const lead = Math.round((c.lead ?? 4.5) * FPS);
  for (let i = 0; i < lead; i++) {
    if (c.setup && i === FPS) await page.evaluate(c.setup);
    await step();
    await sleep(8);
  }

  const dir = `${OUT}clips/${c.name}/`;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const pending = [...(c.at ?? [])].sort((a, b) => a[0] - b[0]);
  const n = Math.round(c.secs * FPS);
  const began = Date.now();
  for (let i = 0; i < n; i++) {
    while (pending.length && pending[0][0] <= i / FPS) await page.evaluate(pending.shift()[1]);
    if (c.tick) await page.evaluate(c.tick);
    await step();
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true });
    await writeFile(`${dir}${String(i).padStart(4, '0')}.jpg`, Buffer.from(data, 'base64'));
  }
  await page.close();
  console.log('clip', c.name, `${n} frames in ${((Date.now() - began) / 1000).toFixed(0)}s`, errors.length ? `errors: ${errors.slice(0, 3).join(' | ')}` : '');
}
await browser.close();
