// NAVIFI hype cut. Every visual is a pure function of time t, so render.mjs can step it
// frame by frame. Open /video/hype.html?t=12.5 in a browser to inspect a single frame.
import { CARD_SECS, CLIP_FRAMES, CRITERIA, CUTS, DURATION, FPS, IMPACTS } from './timeline.mjs';

const W = 1920;
const H = 1080;
const stage = document.getElementById('stage');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const E = {
  outCubic: (k) => 1 - (1 - k) ** 3,
  inOutCubic: (k) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2),
  outExpo: (k) => (k >= 1 ? 1 : 1 - 2 ** (-10 * k)),
  outBack: (k) => 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2,
  inOutSine: (k) => -(Math.cos(Math.PI * k) - 1) / 2,
};
const hash = (n) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  parent.appendChild(e);
  return e;
}
const css = (e, s) => Object.assign(e.style, s);
const q = (root, sel) => root.querySelector(sel);
const qa = (root, sel) => [...root.querySelectorAll(sel)];

const bgLayer = el('div', 'layer', stage);
const footLayer = el('div', 'layer', stage);
const shade = el('div', 'shade', stage);
const overLayer = el('div', 'layer', stage);
const textLayer = el('div', 'layer', stage);
const hudLayer = el('div', 'layer', stage);
const fxLayer = el('div', 'layer', stage);
const grid = el('div', 'grid', bgLayer);

/* ------------------------------------------------------------ timeline items */

const items = [];
let pending = [];
function item(start, end, node, update) {
  node.style.display = 'none';
  items.push({ start, end, node, update, on: false });
  return node;
}
function setSrc(img, src) {
  if (img.dataset.src === src) return;
  img.dataset.src = src;
  img.src = src;
  pending.push(img.decode().catch(() => {}));
}
const fadeInOut = (lt, dur, inS = 0.25, outS = 0.2) => prog(lt, 0, inS) * (1 - prog(lt, dur - outS, dur));

/* ------------------------------------------------------------ footage + camera */

/** Camera: centre (cx, cy) in image-normalized coords and zoom z (1 = full frame). */
function camAt(cam, lt, dur) {
  const k = (cam.ease ?? E.inOutSine)(prog(lt, cam.a ?? 0, cam.b ?? dur));
  const z = lerp(cam.from[2], cam.to[2], k);
  const hx = 0.5 / z;
  return { z, cx: clamp(lerp(cam.from[0], cam.to[0], k), hx, 1 - hx), cy: clamp(lerp(cam.from[1], cam.to[1], k), hx, 1 - hx) };
}
const toScreen = (c, x, y) => [W / 2 + (x - c.cx) * W * c.z, H / 2 + (y - c.cy) * H * c.z];

function shot(start, end, o) {
  const wrap = el('div', 'shot', footLayer);
  const img = el('img', 'media', wrap);
  const s = { start, end, cam: null };
  const cam = o.cam ?? { from: [0.5, 0.5, 1], to: [0.5, 0.5, 1.06] };
  if (o.still) setSrc(img, `footage/stills/${o.still}.png`);
  if (o.blur || o.dim) img.style.filter = `${o.blur ? `blur(${o.blur}px) ` : ''}brightness(${o.dim ?? 1}) saturate(1.1)`;
  if (o.blur) wrap.dataset.bg = '1';
  item(start, end, wrap, (lt) => {
    const c = camAt(cam, lt, end - start);
    s.cam = c;
    img.style.transform = `translate(${W / 2 - c.cx * W * c.z}px, ${H / 2 - c.cy * H * c.z}px) scale(${c.z})`;
    if (o.clip) {
      const f = Math.min(CLIP_FRAMES[o.clip] - 1, Math.floor((o.from ?? 0) + lt * FPS * (o.rate ?? 1)));
      setSrc(img, `footage/clips/${o.clip}/${String(f).padStart(4, '0')}.jpg`);
    }
  });
  return s;
}

function callout(s, at, rect, label, color, side = '') {
  const box = el('div', `callout ${side}`, overLayer, label ? `<div class="callout-tag">${label}</div>` : '');
  box.style.setProperty('--c', color);
  item(s.start + at, s.end, box, (lt) => {
    const c = s.cam;
    const [x0, y0] = toScreen(c, rect[0], rect[1]);
    const [x1, y1] = toScreen(c, rect[0] + rect[2], rect[1] + rect[3]);
    const pad = 8 + (1 - E.outCubic(prog(lt, 0, 0.3))) * 60;
    css(box, { left: `${x0 - pad}px`, top: `${y0 - pad}px`, width: `${x1 - x0 + 2 * pad}px`, height: `${y1 - y0 + 2 * pad}px`, opacity: String(prog(lt, 0, 0.15) * (1 - prog(lt, s.end - s.start - at - 0.15, s.end - s.start - at))) });
  });
}

function tag(start, end, text, color = '#22d3ee') {
  const e = el('div', 'tag', textLayer, `<i></i><span>${text}</span>`);
  e.style.setProperty('--c', color);
  const dot = q(e, 'i');
  item(start, end, e, (lt) => {
    const k = E.outCubic(prog(lt, 0.05, 0.4));
    css(e, { opacity: String(k * (1 - prog(lt, end - start - 0.15, end - start))), transform: `translateX(${(1 - k) * -50}px)` });
    dot.style.opacity = Math.floor(lt * 3) % 2 ? '0.25' : '1';
  });
}

function stat(start, end, { big, line, foot, color, pos }) {
  const e = el('div', 'stat', textLayer, `<b>${big}</b>${line ? `<span>${line}</span>` : ''}${foot ? `<small>${foot}</small>` : ''}`);
  e.style.setProperty('--c', color);
  css(e, pos);
  item(start, end, e, (lt) => {
    const k = E.outBack(prog(lt, 0, 0.35));
    css(e, { opacity: String(prog(lt, 0, 0.12) * (1 - prog(lt, end - start - 0.18, end - start))), transform: `translateY(${(1 - k) * 40}px) scale(${0.92 + 0.08 * k})` });
  });
}

/* ------------------------------------------------------------ criterion cards + lower thirds */

function card(c, i) {
  const t0 = c.card;
  const t1 = c.card + CARD_SECS;
  const root = el('div', 'card', textLayer);
  root.style.setProperty('--c', c.color);
  root.innerHTML = `
    <div class="grid"></div>
    <div class="card-num">${c.n}</div>
    <div class="card-body">
      <div class="card-kicker">JUDGING CRITERION ${c.n} / 05</div>
      <div class="card-name">${c.name}</div>
      <div class="card-weight"><b>0%</b><span>OF THE SCORE</span><div class="wbar"><div class="wfill"></div></div></div>
      <div class="card-punch">${c.punch.map((w, j) => `<span class="w${j === c.punch.length - 1 ? ' last' : ''}">${w}</span>`).join('')}</div>
    </div>
    <div class="card-rubric">${CRITERIA.map((x, j) => `<div class="seg${j === i ? ' on' : j < i ? ' done' : ''}" style="flex:${x.weight}"><span>${x.n} ${x.short.toUpperCase()}</span><em>${x.weight}%</em></div>`).join('')}</div>`;
  const num = q(root, '.card-num');
  const kicker = q(root, '.card-kicker');
  const name = q(root, '.card-name');
  const wnum = q(root, '.card-weight b');
  const wfill = q(root, '.wfill');
  const words = qa(root, '.w');
  const rubric = q(root, '.card-rubric');
  const g = q(root, '.grid');
  item(t0, t1, root, (lt) => {
    const out = prog(lt, CARD_SECS - 0.2, CARD_SECS);
    root.style.opacity = String(1 - out);
    root.style.transform = `scale(${1 + out * 0.06})`;
    g.style.transform = `translate(${-lt * 30}px, ${-lt * 12}px)`;
    const kn = E.outExpo(prog(lt, 0, 0.7));
    css(num, { transform: `translateX(${(1 - kn) * -380}px) scale(${1.25 - 0.25 * kn})`, opacity: String(kn), filter: `drop-shadow(0 0 34px ${c.color}) blur(${(1 - kn) * 14}px)` });
    kicker.style.opacity = String(prog(lt, 0.1, 0.35));
    name.style.clipPath = `inset(0 ${100 - 100 * E.outCubic(prog(lt, 0.15, 0.6))}% 0 0)`;
    const kw = E.outCubic(prog(lt, 0.3, 1.0));
    wnum.textContent = `${Math.round(c.weight * kw)}%`;
    wfill.style.width = `${c.weight * kw}%`;
    words.forEach((w, j) => {
      const k = E.outBack(prog(lt, 0.55 + j * 0.11, 0.9 + j * 0.11));
      css(w, { opacity: String(prog(lt, 0.55 + j * 0.11, 0.7 + j * 0.11)), transform: `translateY(${(1 - k) * 50}px)`, filter: `blur(${(1 - prog(lt, 0.55 + j * 0.11, 0.8 + j * 0.11)) * 10}px)` });
    });
    css(rubric, { opacity: String(prog(lt, 0.4, 0.8)), transform: `translateY(${(1 - E.outCubic(prog(lt, 0.4, 0.9))) * 40}px)` });
  });
}

function lower(c) {
  const start = c.card + CARD_SECS;
  const e = el('div', 'lower', textLayer, `<div class="lower-k"><b>${c.n}</b>${c.name}<em>${c.weight}%</em></div><div class="lower-t">${c.attack}</div>`);
  e.style.setProperty('--c', c.color);
  const text = q(e, '.lower-t');
  item(start, c.end, e, (lt) => {
    const dur = c.end - start;
    const k = E.outCubic(prog(lt, 0.15, 0.55));
    css(e, { opacity: String(prog(lt, 0.15, 0.4) * (1 - prog(lt, dur - 0.2, dur))), transform: `translateY(${(1 - k) * 30}px)` });
    text.style.clipPath = `inset(0 ${100 - 100 * E.inOutCubic(prog(lt, 0.3, 1.6))}% 0 0)`;
  });
}

/* ------------------------------------------------------------ cold open: five reports, one controls */

function coldOpen() {
  const ROWS = [
    { status: 'DEGRADED', sys: 'MCM USV-1', detail: 'Propulsion maintenance +30 min', c: '#fbbf24' },
    { status: 'DEGRADED', sys: 'MH-60S 61', detail: 'Launch delayed 45 min', c: '#fbbf24' },
    { status: 'FAULT', sys: 'MVCS LINK', detail: 'USV comms intermittent', c: '#fb923c' },
    { status: 'UP', sys: 'AQS-20C SONAR', detail: 'Minehunting sonar ready', c: '#34d399' },
    { status: 'CONSTRAINT', sys: 'PMA REVIEWER', detail: 'Qualified analyst away 1300–1645', c: '#fb3b5c', key: true },
  ];
  const typed = '> USS CAPE CHARLES (LCS-42) · OPERATION OPEN PASSAGE · STATUS BOARD 0600–1000';
  const root = el('div', 'cold', textLayer);
  root.innerHTML = `<div class="cold-type"></div>
    <div class="cold-head"><span class="h1">FIVE SYSTEMS REPORT STATUS.</span><span class="h2">ONLY ONE CONTROLS THE MISSION.</span></div>
    <div class="cold-rows">${ROWS.map((r) => `<div class="row" style="--c:${r.c}"><b>${r.status}</b><span>${r.sys}</span><em>${r.detail}</em>${r.key ? '<div class="ctl">CONTROLS · −1h 15m</div>' : '<div class="strike"></div>'}</div>`).join('')}</div>`;
  const type = q(root, '.cold-type');
  const h1 = q(root, '.h1');
  const h2 = q(root, '.h2');
  const rows = qa(root, '.row');
  item(0, 6, root, (lt) => {
    type.textContent = typed.slice(0, Math.floor(typed.length * prog(lt, 0.25, 1.35))) + (Math.floor(lt * 4) % 2 ? '▌' : ' ');
    type.style.opacity = String(1 - prog(lt, 5.6, 6));
    const k1 = E.outBack(prog(lt, 1.5, 1.85));
    css(h1, { opacity: String(prog(lt, 1.5, 1.65) * (1 - prog(lt, 3.9, 4.0))), transform: `scale(${0.9 + 0.1 * k1})` });
    const k2 = E.outExpo(prog(lt, 4.0, 4.35));
    css(h2, { opacity: String(prog(lt, 4.0, 4.05) * (1 - prog(lt, 5.7, 6))), transform: `scale(${1.35 - 0.35 * k2})`, filter: `blur(${(1 - k2) * 8}px)` });
    rows.forEach((r, j) => {
      const at = 1.5 + j * 0.5;
      const k = E.outBack(prog(lt, at, at + 0.32));
      const key = ROWS[j].key;
      const verdict = E.outCubic(prog(lt, 4.0, 4.45));
      const dim = key ? 1 : 1 - 0.72 * verdict;
      const strike = q(r, '.strike');
      const ctl = q(r, '.ctl');
      if (strike) strike.style.transform = `scaleX(${verdict})`;
      if (ctl) ctl.style.opacity = String(verdict);
      if (key) q(r, 'em').style.opacity = String(1 - verdict);
      css(r, {
        opacity: String(prog(lt, at, at + 0.12) * dim * (1 - prog(lt, 5.65, 6))),
        transform: `translateX(${(1 - k) * 160}px) scale(${key ? 1 + 0.06 * verdict : 1})`,
        boxShadow: key ? `0 0 ${60 * verdict}px rgba(251,59,92,${0.65 * verdict})` : 'none',
      });
    });
  });
}

/* ------------------------------------------------------------ logo */

function logo(start, end, final) {
  const root = el('div', 'logo', textLayer);
  root.innerHTML = `<div class="logo-glow"></div>
    <div class="logo-word">${'NAVIFI'.split('').map((ch) => `<span>${ch}</span>`).join('')}</div>
    <div class="logo-sub">MISSION CONSEQUENCE ENGINE</div>
    <div class="logo-tag">Know before it breaks the mission.</div>
    ${final ? '<div class="logo-foot"><b>UNCOMN · FLEETHACKER NORFOLK 2026</b><small>SYNTHETIC DATA ONLY · NOT AN AUTHORITATIVE SYSTEM · A HUMAN DECIDES</small></div>' : ''}`;
  const letters = qa(root, '.logo-word span');
  const sub = q(root, '.logo-sub');
  const tg = q(root, '.logo-tag');
  const foot = q(root, '.logo-foot');
  const glow = q(root, '.logo-glow');
  item(start, end, root, (lt) => {
    const dur = end - start;
    root.style.opacity = String(final ? 1 : 1 - prog(lt, dur - 0.15, dur));
    letters.forEach((s, j) => {
      const k = E.outExpo(prog(lt, j * 0.06, 0.45 + j * 0.06));
      css(s, { opacity: String(k), transform: `translateY(${(1 - k) * -60}px) scale(${1.6 - 0.6 * k})`, filter: `blur(${(1 - k) * 16}px)` });
    });
    glow.style.opacity = String(0.6 + 0.4 * Math.sin(lt * 3) ** 2);
    sub.style.opacity = String(prog(lt, 0.5, 0.8));
    sub.style.letterSpacing = `${0.9 - 0.28 * E.outCubic(prog(lt, 0.5, 1.2))}em`;
    css(tg, { opacity: String(prog(lt, 0.8, 1.1)), transform: `translateY(${(1 - E.outCubic(prog(lt, 0.8, 1.2))) * 24}px)` });
    if (foot) foot.style.opacity = String(prog(lt, 1.3, 1.7));
  });
}

/* ------------------------------------------------------------ speed to fleet: the stack */

function stackScene(start, end) {
  const LAYERS = [
    { b: 'SHIP HARDWARE', s: 'CANES-class rack (notional) · no internet', c: '#94a3b8' },
    { b: 'RHEL 9', s: 'DISA STIG · FIPS 140-3 · SELinux enforcing', c: '#fb7185' },
    { b: 'RKE2', s: 'CIS-hardened Kubernetes · local registry', c: '#60a5fa' },
    { b: 'UDS CORE', s: 'Defense Unicorns · Istio · Keycloak · Pepr · NeuVector', c: '#22d3ee' },
    { b: 'NAVIFI', s: 'engine · edge sync · local narrator · audit', c: '#f0fdff' },
  ];
  const root = el('div', 'layer', textLayer);
  root.innerHTML = `
    <div class="stack-title">COMMIT TO HULL. AIR-GAPPED.</div>
    <div class="stack-sub">ONE SIGNED ZARF PACKAGE · SAME ARTIFACT ON EVERY HULL</div>
    <div class="airgap"><i>AIR GAP</i></div>
    <div class="pkg"><b>ZARF PACKAGE</b><span>navifi-0.10.0.tar.zst<br>cosign signed · SBOM · 0 critical CVEs</span></div>
    <div class="stack-layers">${LAYERS.map((l) => `<div class="layer-box" style="--c:${l.c}"><b>${l.b}</b><span>${l.s}</span></div>`).join('')}</div>
    <div class="profiles">
      <div class="profile" style="--c:#34d399"><b>PROFILE A · DEMONSTRATED</b><span>RHEL 9 + RKE2 + Zarf + UDS Core</span><small>offline install · runs in EMCON</small></div>
      <div class="profile target" style="--c:#fbbf24"><b>PROFILE B · TARGET</b><span>OpenShift / CANES ACS</span><small>same OCI images + Helm chart</small></div>
    </div>`;
  const title = q(root, '.stack-title');
  const sub = q(root, '.stack-sub');
  const boxes = qa(root, '.layer-box');
  const pkg = q(root, '.pkg');
  const gap = q(root, '.airgap');
  const profs = qa(root, '.profile');
  item(start, end, root, (lt) => {
    const dur = end - start;
    root.style.opacity = String(1 - prog(lt, dur - 0.18, dur));
    css(title, { opacity: String(prog(lt, 0, 0.2)), transform: `translateY(${(1 - E.outCubic(prog(lt, 0, 0.4))) * -30}px)` });
    sub.style.opacity = String(prog(lt, 0.2, 0.5));
    boxes.forEach((b, j) => {
      const k = E.outBack(prog(lt, j * 0.5, j * 0.5 + 0.35));
      css(b, { opacity: String(prog(lt, j * 0.5, j * 0.5 + 0.1)), transform: `translateY(${(1 - k) * 70}px)` });
    });
    gap.style.opacity = String(prog(lt, 1.6, 2.0));
    const kp = E.inOutCubic(prog(lt, 2.2, 3.0));
    css(pkg, { opacity: String(prog(lt, 1.8, 2.1) * (1 - prog(lt, 3.0, 3.25))), transform: `translateX(${kp * 560}px) scale(${1 - 0.25 * kp})` });
    boxes[4].style.boxShadow = `0 0 ${30 + 60 * prog(lt, 3.0, 3.2) * (1 - prog(lt, 3.3, 3.9))}px rgba(34,211,238,0.8)`;
    profs.forEach((p, j) => {
      const k = E.outCubic(prog(lt, 2.6 + j * 0.4, 3.0 + j * 0.4));
      css(p, { opacity: String(k), transform: `translateX(${(1 - k) * 80}px)` });
    });
  });
}

/* ------------------------------------------------------------ fleet scalability */

function montageLabel(start, end, big, small, color) {
  const e = el('div', 'mlabel', textLayer, `<b>${big}</b><span>${small}</span>`);
  e.style.setProperty('--c', color);
  item(start, end, e, (lt) => {
    const k = E.outExpo(prog(lt, 0, 0.3));
    css(e, { opacity: String(k), transform: `translateX(${(1 - k) * -90}px)` });
  });
}

function counters(start, end) {
  const C = [
    { b: '4', s: 'MISSION THREADS', m: 'MCM · AMD · VLS reload · radar repair', c: '#60a5fa' },
    { b: '2', s: 'SHIP CLASSES', m: 'LCS · DDG', c: '#22d3ee' },
    { b: '3', s: 'HULLS', m: 'LCS-42 · DDG-170 · DDG-173', c: '#34d399' },
    { b: '1', s: 'ENGINE', m: 'zero rewrites between missions', c: '#fbbf24' },
  ];
  const root = el('div', 'layer', textLayer);
  root.innerHTML = `<div class="counters-title">THREADS ARE DATA.</div>
    <div class="counters-sub">Hand-laid for MCM. Auto-laid from the dependency graph for every other mission.</div>
    <div class="counters">${C.map((c) => `<div class="counter" style="--c:${c.c}"><b>${c.b}</b><span>${c.s}</span><small>${c.m}</small></div>`).join('')}</div>`;
  const title = q(root, '.counters-title');
  const sub = q(root, '.counters-sub');
  const cs = qa(root, '.counter');
  item(start, end, root, (lt) => {
    const dur = end - start;
    root.style.opacity = String(1 - prog(lt, dur - 0.18, dur));
    const kt = E.outExpo(prog(lt, 0, 0.4));
    css(title, { opacity: String(kt), transform: `scale(${1.2 - 0.2 * kt})` });
    sub.style.opacity = String(prog(lt, 0.3, 0.6));
    cs.forEach((c, j) => {
      const at = 0.5 + j * 0.5;
      const k = E.outBack(prog(lt, at, at + 0.35));
      css(c, { opacity: String(prog(lt, at, at + 0.1)), transform: `translateY(${(1 - k) * 80}px) scale(${0.9 + 0.1 * k})` });
    });
  });
}

/* ------------------------------------------------------------ barrier removal: feeds collapse into one picture */

function feeds(start, end) {
  const F = [
    ['OMMS-NG', 'CASREP'], ['R-SUPPLY', 'parts'], ['NSIPS', 'orders'], ['SKED', 'schedule'],
    ['DRRS-N', 'readiness'], ['WATCHBILL', 'people'], ['MVCS', 'USV link'], ['AMHS', 'messages'],
  ];
  const root = el('div', 'layer', textLayer);
  const top = 150;
  const step = 76;
  root.innerHTML = `<div class="feeds-shade"></div>
    <svg class="wires" width="1920" height="1080">${F.map((_, j) => `<path d="M400 ${top + j * step + 29} C 520 ${top + j * step + 29}, 540 505, 640 505" fill="none" stroke="#fbbf24" stroke-width="2" stroke-opacity="0.7"/>`).join('')}</svg>
    ${F.map(([a, b], j) => `<div class="feed" style="top:${top + j * step}px"><span>${a}</span><small>${b}</small></div>`).join('')}
    <div class="hub"><b>ONE OPERATIONAL PICTURE</b><span>READ-ONLY · NO RE-ENTRY</span></div>`;
  const chips = qa(root, '.feed');
  const wires = qa(root, 'path');
  const hub = q(root, '.hub');
  const sh = q(root, '.feeds-shade');
  wires.forEach((p) => {
    const len = p.getTotalLength();
    p.style.strokeDasharray = `${len}`;
    p.dataset.len = String(len);
  });
  item(start, end, root, (lt) => {
    const dur = end - start;
    root.style.opacity = String(1 - prog(lt, dur - 0.18, dur));
    sh.style.opacity = String(prog(lt, 0, 0.3));
    chips.forEach((c, j) => {
      const at = 0.2 + j * 0.16;
      const k = E.outExpo(prog(lt, at, at + 0.4));
      css(c, { opacity: String(k), transform: `translateX(${(1 - k) * -380}px)` });
      const w = wires[j];
      w.style.strokeDashoffset = String(Number(w.dataset.len) * (1 - E.inOutCubic(prog(lt, at + 0.3, at + 0.9))));
    });
    const kh = E.outBack(prog(lt, 1.9, 2.3));
    css(hub, { opacity: String(prog(lt, 1.9, 2.0)), transform: `scale(${0.7 + 0.3 * kh})`, boxShadow: `0 0 ${40 + 40 * Math.sin(lt * 5) ** 2}px rgba(34,211,238,0.55)` });
  });
}

/* ------------------------------------------------------------ judges' discretion + recap */

function lines(start, end, L) {
  const root = el('div', 'lines', textLayer, L.map((l) => `<div class="line" style="--c:${l.c}"><b>${l.b}</b><span>${l.s}</span></div>`).join(''));
  const ls = qa(root, '.line');
  item(start, end, root, (lt) => {
    const dur = end - start;
    root.style.opacity = String(1 - prog(lt, dur - 0.18, dur));
    ls.forEach((l, j) => {
      const at = j * 0.5;
      const k = E.outExpo(prog(lt, at, at + 0.35));
      css(l, { opacity: String(k), transform: `translateX(${(1 - k) * 140}px)` });
    });
  });
}

function recap(start, end) {
  const root = el('div', 'layer', textLayer);
  root.innerHTML = `<div class="recap-title">FIVE CRITERIA. ONE EXECUTABLE MISSION THREAD.</div>
    <div class="recap">${CRITERIA.map((c) => `<div class="rrow" style="--c:${c.color}"><div class="n">${c.n}</div><div class="nm"><b>${c.name}</b><i style="width:${c.weight * 3.2}%"></i></div><div class="p">${c.punch.join(' ')}</div><div class="chk">${c.weight}%</div></div>`).join('')}</div>`;
  const title = q(root, '.recap-title');
  const rows = qa(root, '.rrow');
  item(start, end, root, (lt) => {
    const dur = end - start;
    root.style.opacity = String(1 - prog(lt, dur - 0.2, dur));
    css(title, { opacity: String(prog(lt, 0, 0.25)), transform: `translateY(${(1 - E.outCubic(prog(lt, 0, 0.4))) * -30}px)` });
    rows.forEach((r, j) => {
      const at = 0.5 + j * 0.5;
      const k = E.outExpo(prog(lt, at, at + 0.35));
      css(r, { opacity: String(k), transform: `translateX(${(1 - k) * -160}px)` });
    });
  });
}

/* ------------------------------------------------------------ the cut */

const [C1, C2, C3, C4, C5] = CRITERIA;
const CRIT = '#fb3b5c';
const OK = '#34d399';
const AMBER = '#fbbf24';

coldOpen();

// 6–8 · logo slam
shot(6, 8, { still: 'thread_0600', blur: 14, dim: 0.32, cam: { from: [0.5, 0.5, 1.15], to: [0.5, 0.5, 1.3] } });
logo(6, 8, false);

// 01 · warfighting & deckplate impact
card(C1, 0);
shot(11, 15.5, { clip: 'run_thread', rate: 2.6, cam: { from: [0.5, 0.48, 1.0], to: [0.53, 0.42, 1.14] } });
tag(11, 15.5, 'Live · the mission thread, executing');
shot(15.5, 20, { clip: 'reports_land', rate: 3.2, cam: { from: [0.5, 0.42, 1.04], to: [0.5, 0.38, 1.12] } });
tag(15.5, 20, 'Four reports land · engine recomputes in ms', AMBER);
const s1000 = shot(20, 24, { still: 'thread_1000', cam: { from: [0.5, 0.5, 1.0], to: [0.63, 0.4, 1.42], b: 2.2, ease: E.inOutCubic } });
callout(s1000, 1.0, [0.629, 0.512, 0.08, 0.088], 'Waits 1300–1645 · OS1 Vega', CRIT);
callout(s1000, 1.5, [0.882, 0.213, 0.085, 0.069], '−1h 15m · not ready', CRIT, 'below left');
callout(s1000, 2.0, [0.44, 0.09, 0.116, 0.055], 'Controlling constraint', AMBER, 'below');
stat(22.4, 24, { big: '4 reports. 1 controls.', line: 'The analyst’s review window, not the hardware.', color: CRIT, pos: { left: '70px', top: '360px' } });
lower(C1);

// 02 · speed to fleet
card(C2, 1);
shot(27, 30.5, { clip: 'boot', from: 30, rate: 1.6, cam: { from: [0.5, 0.5, 1.0], to: [0.6, 0.48, 1.2] } });
tag(27, 30.5, 'Boots offline · signed · self-test 39/39', OK);
shot(30.5, 34, { clip: 'emcon', rate: 1.2, cam: { from: [0.5, 0.5, 1.0], to: [0.25, 0.8, 1.75], b: 1.8 } });
tag(30.5, 34, 'Link: SATCOM → DDIL → EMCON', AMBER);
stat(32.6, 34, { big: 'Link down. Still on.', line: 'Engine, options and audit run on the ship.', color: OK, pos: { left: '980px', top: '160px' } });
shot(34, 38, { still: 'edge_emcon', blur: 10, dim: 0.25, cam: { from: [0.5, 0.5, 1.1], to: [0.5, 0.5, 1.2] } });
stackScene(34, 38);
lower(C2);

// 03 · fleet scalability
card(C3, 2);
const MONTAGE = [
  ['thread_0600', 'LCS-42', 'Mine countermeasures · 12 h · hand-laid', '#22d3ee', [0.48, 0.45]],
  ['thread_ddg', 'DDG-170', 'Air & missile defense · 21 days · auto-laid', '#fbbf24', [0.52, 0.5]],
  ['thread_vls', 'DDG-173', 'VLS reload · 72 h · auto-laid', '#fb3b5c', [0.48, 0.5]],
  ['thread_radar', 'DDG-170', 'Radar repair · 10 h · auto-laid', '#34d399', [0.52, 0.5]],
];
MONTAGE.forEach(([still, big, small, color, [x, y]], j) => {
  const t = 41 + j;
  shot(t, t + 1, { still, cam: { from: [x, y, 1.04], to: [1 - x, y, 1.12] } });
  montageLabel(t, t + 1, big, small, color);
});
shot(45, 50, { clip: 'thread_switch', blur: 9, dim: 0.28, rate: 1.4, cam: { from: [0.5, 0.5, 1.05], to: [0.5, 0.5, 1.15] } });
counters(45, 50);
lower(C3);

// 04 · barrier removal
card(C4, 3);
shot(53, 57.5, { clip: 'watch_feed', rate: 2.6, cam: { from: [0.55, 0.5, 1.0], to: [0.6, 0.5, 1.1] } });
feeds(53, 57.5);
const sEvd = shot(57.5, 62, { still: 'evidence', cam: { from: [0.5, 0.5, 1.0], to: [0.224, 0.86, 2.25], b: 1.8, ease: E.inOutCubic } });
callout(sEvd, 2.0, [0.046, 0.79, 0.355, 0.05], '', AMBER);
stat(59.6, 62, { big: 'Minutes → ms', line: 'After every change, with sources attached.', foot: 'BASELINE IS A TEAM TABLETOP ESTIMATE · SYNTHETIC DATA', color: AMBER, pos: { left: '1000px', top: '130px' } });
lower(C4);

// 05 · judges' discretion
card(C5, 4);
shot(65, 69, { clip: 'approve', from: 10, rate: 1.6, cam: { from: [0.86, 0.86, 1.9], to: [0.5, 0.5, 1.0], a: 1.3, b: 3.3, ease: E.inOutCubic } });
tag(65, 69, 'A human approves · planning assumption, never an order', '#c084fc');
shot(69, 73, { clip: 'tamper', rate: 2.0, cam: { from: [0.5, 0.4, 1.06], to: [0.5, 0.36, 1.18] } });
tag(69, 73, 'Every decision hash-chained', '#c084fc');
stat(70.5, 71.9, { big: 'Tamper detected', color: CRIT, pos: { left: '1120px', top: '430px' } });
stat(71.9, 73, { big: 'Restored', line: 'From the edge copy. Chain intact.', color: OK, pos: { left: '1120px', top: '430px' } });
shot(73, 76, { still: 'graph_mcm', blur: 7, dim: 0.3, cam: { from: [0.5, 0.5, 1.1], to: [0.5, 0.5, 1.2] } });
lines(73, 76, [
  { b: 'Deterministic engine.', s: 'Same inputs, same answer, every time.', c: '#22d3ee' },
  { b: 'GenAI only explains.', s: 'Identical answer with the LLM off.', c: '#a78bfa' },
  { b: 'Approve · reject · STOP.', s: 'Every call logged to the hash chain.', c: '#c084fc' },
  { b: '39/39 tests · 12/12 failure cases.', s: 'Run live, in front of the judges.', c: '#34d399' },
]);
lower(C5);

// outro
recap(76, 80);
logo(80, DURATION, true);

/* ------------------------------------------------------------ HUD + finishing */

const classbar = el('div', 'classbar', hudLayer);
const CLASS_TEXT = 'UNCLASSIFIED // SYNTHETIC DATA // FLEETHACKER NORFOLK 2026 // NOT AN AUTHORITATIVE RECORD';
const corners = ['tl', 'tr', 'bl', 'br'].map((p) => el('div', `corner ${p}`, hudLayer));
const timecode = el('div', 'timecode', hudLayer);
const rubric = el('div', 'rubric', hudLayer, `<div class="lbl"><span>JUDGING RUBRIC</span><b></b></div><div class="bar">${CRITERIA.map((c) => `<div style="flex:${c.weight}"></div>`).join('')}</div>`);
const rubricSegs = qa(rubric, '.bar div');
const rubricLbl = q(rubric, '.lbl b');

const flash = el('div', 'flash', fxLayer);
const gbars = [0, 1, 2, 3].map(() => el('div', 'gbar', fxLayer));
el('div', 'scan', fxLayer);
el('div', 'vignette', fxLayer);
const grain = el('canvas', 'grain', fxLayer);
grain.width = 480;
grain.height = 270;
const fade = el('div', 'fade', fxLayer);
const gctx = grain.getContext('2d');
const noise = gctx.createImageData(480, 270);

function hud(t) {
  const n = Math.floor(CLASS_TEXT.length * prog(t, 0.05, 0.9));
  classbar.textContent = CLASS_TEXT.slice(0, n);
  classbar.style.opacity = String(1 - prog(t, DURATION - 0.6, DURATION));
  const showHud = t > 8 && t < 80 ? 1 : 0;
  corners.forEach((c) => (c.style.opacity = String(0.35 + 0.65 * showHud)));
  const f = Math.floor(t * FPS);
  timecode.style.opacity = items.some((it) => it.on && it.node.classList.contains('shot') && !it.node.dataset.bg) ? '0' : '1';
  timecode.innerHTML = `<i style="opacity:${Math.floor(t * 2) % 2 ? 0.3 : 1}"></i>NAVIFI · T+${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}:${String(f % FPS).padStart(2, '0')}`;
  const idx = CRITERIA.findIndex((c) => t >= c.card && t < c.end);
  rubric.style.opacity = String(prog(t, 10.5, 11) * (1 - prog(t, 75.5, 76)));
  rubricSegs.forEach((s, j) => {
    const c = CRITERIA[j];
    const live = j === idx;
    s.style.background = live ? c.color : j < idx || t >= 76 ? `${c.color}66` : 'rgba(148,163,184,0.2)';
    s.style.boxShadow = live ? `0 0 14px ${c.color}` : 'none';
  });
  rubricLbl.textContent = idx >= 0 ? `${CRITERIA[idx].n} · ${CRITERIA[idx].weight}%` : '';
}

function fx(t) {
  let fl = 0;
  let glitch = 0;
  let cutAt = 0;
  for (const c of CUTS) {
    if (t >= c && t - c < 0.4) {
      fl = Math.max(fl, (IMPACTS.includes(c) ? 1 : 0.45) * Math.exp(-(t - c) / 0.07));
      if (t - c < 0.14) {
        glitch = 1 - (t - c) / 0.14;
        cutAt = c;
      }
    }
  }
  flash.style.opacity = String(0.55 * fl);
  gbars.forEach((b, j) => {
    const r = hash(cutAt * 31 + j * 7 + Math.floor(t * FPS));
    css(b, { display: glitch > 0 ? '' : 'none', top: `${r * H}px`, height: `${4 + hash(r * 99) * 26}px`, opacity: String(glitch * 0.8) });
  });
  let shake = 0;
  for (const i of IMPACTS) if (t >= i && t - i < 0.7) shake += 16 * Math.exp(-(t - i) / 0.16);
  const jx = glitch * (hash(Math.floor(t * FPS)) - 0.5) * 36 + shake * Math.sin(t * 93);
  const jy = shake * Math.cos(t * 71);
  for (const l of [footLayer, overLayer, textLayer]) l.style.transform = `translate(${jx}px, ${jy}px)`;
  footLayer.style.filter = glitch > 0 ? `saturate(${1 + glitch}) hue-rotate(${glitch * 25}deg) contrast(${1 + glitch * 0.3})` : '';
  grid.style.transform = `translate(${(-t * 18) % 64}px, ${(-t * 7) % 64}px)`;
  const seed = Math.floor(t * FPS);
  const d = noise.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = hash(i * 0.37 + seed * 17.13) * 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  gctx.putImageData(noise, 0, 0);
  const anyShot = items.some((it) => it.on && it.node.classList.contains('shot'));
  shade.style.opacity = anyShot ? '1' : '0';
  fade.style.opacity = String(prog(t, 0, 0.0001) < 1 ? 1 : prog(t, DURATION - 0.8, DURATION));
}

window.renderFrame = async (t) => {
  pending = [];
  for (const it of items) {
    const on = t >= it.start && t < it.end;
    if (on !== it.on) {
      it.node.style.display = on ? '' : 'none';
      it.on = on;
    }
    if (on) it.update(t - it.start, t);
  }
  hud(t);
  fx(t);
  await Promise.all(pending);
};

window.__ready = (async () => {
  await document.fonts.ready;
  await Promise.all([...document.fonts].map((f) => f.load().catch(() => {})));
  await Promise.all(pending);
  pending = [];
  const t = Number(new URLSearchParams(location.search).get('t') ?? 0);
  await window.renderFrame(t);
  return { duration: DURATION, fps: FPS };
})();
