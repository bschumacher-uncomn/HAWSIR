// Synthesizes the hype cut's soundtrack, locked to timeline.mjs: 120 BPM, A minor (Am–F–C–G),
// kick/bass/hats/clap/arp/pad plus risers, impacts, whooshes and UI blips on the cut points.
// usage: node video/score.mjs  → video/out/score.wav (48 kHz, 16-bit stereo)
import { mkdir, writeFile } from 'node:fs/promises';
import { BLIPS, CUTS, DRUMS, DURATION, IMPACTS, RISERS } from './timeline.mjs';

const SR = 48000;
const N = Math.round(DURATION * SR);
const L = new Float32Array(N);
const R = new Float32Array(N);
const SEND = new Float32Array(N);
const BEAT = 0.5;
const TAU = Math.PI * 2;

let seed = 0x9e3779b9;
const rnd = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) / 4294967296) * 2 - 1;
};
const at = (t) => Math.round(t * SR);
function put(t0, len, fn, gl = 1, gr = gl, send = 0) {
  const s0 = at(t0);
  for (let i = 0; i < len; i++) {
    const n = s0 + i;
    if (n < 0 || n >= N) continue;
    const v = fn(i / SR, i);
    L[n] += v * gl;
    R[n] += v * gr;
    SEND[n] += v * send;
  }
}
const inBreak = (t) => DRUMS.breaks.some(([a, b]) => t >= a && t < b);
const drumsOn = (t) => t >= DRUMS.from && t < DRUMS.to && !inBreak(t);

/* chords: one per bar */
const CHORDS = [
  { root: 55.0, tones: [220.0, 261.63, 329.63] },
  { root: 43.65, tones: [174.61, 220.0, 261.63] },
  { root: 65.41, tones: [261.63, 329.63, 392.0] },
  { root: 49.0, tones: [196.0, 246.94, 293.66] },
];
const chordAt = (t) => (t < 8 ? CHORDS[0] : CHORDS[Math.floor((t - 8) / 2) % 4]);

/* ---------------- drums */
const kicks = [];
for (let t = DRUMS.from; t < DRUMS.to - 1e-6; t += BEAT) if (drumsOn(t)) kicks.push(t);
for (const t of kicks) {
  let ph = 0;
  put(t, at(0.5), (x) => {
    ph += (TAU * (44 + 120 * Math.exp(-x * 30))) / SR;
    return Math.sin(ph) * Math.exp(-x * 6.5) * 0.95 + (x < 0.004 ? rnd() * 0.35 * (1 - x / 0.004) : 0);
  }, 0.85, 0.85);
}
const lastKickBefore = (t) => {
  let lo = 0;
  let hi = kicks.length - 1;
  let best = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (kicks[m] <= t) {
      best = kicks[m];
      lo = m + 1;
    } else hi = m - 1;
  }
  return best;
};
const duck = (t) => {
  const k = lastKickBefore(t);
  return k < 0 ? 1 : 1 - 0.75 * Math.exp(-(t - k) * 9);
};

for (let t = 11; t < DRUMS.to - 1e-6; t += BEAT) {
  if (!drumsOn(t)) continue;
  let lp = 0;
  put(t + BEAT / 2, at(0.09), (x) => {
    const n = rnd();
    lp += 0.35 * (n - lp);
    return (n - lp) * Math.exp(-x * 55);
  }, 0.13, 0.1);
}
for (let t = 24; t < DRUMS.to - 1e-6; t += BEAT) {
  const beatInBar = Math.round((t - 8) / BEAT) % 4;
  if (!drumsOn(t) || (beatInBar !== 1 && beatInBar !== 3)) continue;
  let bp1 = 0;
  let bp2 = 0;
  put(t, at(0.35), (x) => {
    const n = rnd();
    bp1 += 0.5 * (n - bp1);
    bp2 += 0.12 * (bp1 - bp2);
    const bursts = x < 0.012 ? 1 : x < 0.024 ? 0.6 : 1;
    return ((bp1 - bp2) * 2.2 * bursts * Math.exp(-x * 16) + Math.sin(TAU * 185 * x) * Math.exp(-x * 30) * 0.4);
  }, 0.24, 0.26, 0.25);
}
for (let t = 8; t < DRUMS.to - 1e-6; t += 0.25) {
  const kick = drumsOn(t) && Math.abs((t - 8) / BEAT - Math.round((t - 8) / BEAT)) < 1e-6;
  if (!drumsOn(t) || kick || t < 38) continue;
  let hp = 0;
  put(t, at(0.04), (x) => {
    const n = rnd();
    hp += 0.6 * (n - hp);
    return (n - hp) * Math.exp(-x * 120);
  }, 0.05, 0.07);
}

/* ---------------- bass: driving eighths under the kick */
for (let t = 8; t < DRUMS.to - 1e-6; t += 0.25) {
  if (!drumsOn(t)) continue;
  const f = chordAt(t).root * (Math.round((t - 8) / 0.25) % 8 === 7 ? 2 : 1);
  let lp = 0;
  let ph = 0;
  put(t, at(0.24), (x) => {
    ph += f / SR;
    const saw = 2 * (ph % 1) - 1 + (2 * ((ph * 1.006) % 1) - 1);
    const cut = 0.02 + 0.12 * Math.exp(-x * 18);
    lp += cut * (saw * 0.5 - lp);
    const env = Math.min(1, x / 0.004) * (1 - x / 0.24) ** 0.6;
    return (lp * 1.6 + Math.sin(TAU * f * x) * 0.7) * env * duck(t + x);
  }, 0.34, 0.34);
}

/* ---------------- pad: detuned saws, slow filter, whole piece */
{
  const lp = [0, 0];
  const phs = Array.from({ length: 2 }, () => new Float64Array(9));
  const start = 0;
  put(start, N, (x) => {
    const t = start + x;
    const ch = chordAt(t);
    const next = chordAt(t + 0.15);
    const blend = ch === next ? 0 : prog(t % 2, 1.85, 2);
    const amp = 0.55 * Math.min(1, t / 1.5) * (1 - prog(t, DURATION - 3.5, DURATION)) * (t >= 80 ? 1.2 : 1);
    let out = 0;
    for (let c = 0; c < 2; c++) {
      let s = 0;
      let k = 0;
      for (const [j, f0] of ch.tones.entries()) {
        const f = f0 * (1 - blend) + next.tones[j] * blend;
        for (const d of [-0.006, 0, 0.007]) {
          phs[c][k] += (f * (1 + d + c * 0.002)) / SR;
          s += 2 * (phs[c][k] % 1) - 1;
          k++;
        }
      }
      const cut = 0.012 + 0.008 * Math.sin(TAU * 0.07 * t) + (t > 8 && t < 80 ? 0.01 : 0);
      lp[c] += cut * (s / 9 - lp[c]);
    }
    out = (lp[0] + lp[1]) * 0.5;
    return out * amp * (0.6 + 0.4 * duck(t));
  }, 0.5, 0.5, 0.35);
}

/* ---------------- arp: sixteenths, delayed, from speed-to-fleet on */
const delayL = new Float32Array(N);
const delayR = new Float32Array(N);
for (let t = 24; t < 76 - 1e-6; t += 0.125) {
  if (inBreak(t)) continue;
  const ch = chordAt(t);
  const pattern = [0, 1, 2, 3, 2, 1, 2, 3];
  const step = Math.round((t - 24) / 0.125) % 8;
  const tones = [...ch.tones.map((f) => f * 2), ch.tones[0] * 4];
  const f = tones[pattern[step]];
  put(t, at(0.12), (x) => {
    const sq = Math.sin(TAU * f * x) + 0.35 * Math.sin(TAU * f * 3 * x) / 3 + 0.2 * Math.sin(TAU * f * 5 * x) / 5;
    return sq * Math.exp(-x * 26) * Math.min(1, x / 0.002);
  }, 0.07, 0.07, 0.2);
  const s0 = at(t);
  const len = at(0.12);
  for (let i = 0; i < len; i++) {
    const n = s0 + i;
    if (n >= N) break;
    const x = i / SR;
    delayL[n] += Math.sin(TAU * f * x) * Math.exp(-x * 26) * 0.05;
  }
}
{
  const dl = at(0.375);
  for (let n = 0; n < N; n++) {
    const a = n >= dl ? delayR[n - dl] * 0.4 + delayL[n - dl] : 0;
    const b = n >= dl ? a * 0.4 : 0;
    delayR[n] += a;
    L[n] += b;
    R[n] += a * 0.8;
  }
}

/* ---------------- cold-open drone and typing */
{
  let lp = 0;
  let ph = 0;
  put(0, at(8.2), (x) => {
    ph += 55 / SR;
    const s = (2 * (ph % 1) - 1) * 0.6 + Math.sin(TAU * 110 * x) * 0.3;
    lp += 0.01 * (s - lp);
    const swell = Math.min(1, x / 2) * (1 - prog(x, 7.6, 8.2)) * (x > 4 ? 1.4 : 1);
    return lp * swell;
  }, 0.5, 0.5, 0.2);
}
for (let t = 0.25; t < 1.35; t += 0.045) put(t, at(0.012), (x) => rnd() * Math.exp(-x * 400), 0.05, 0.04);

/* ---------------- FX: risers, impacts, whooshes, blips */
for (const end of RISERS) {
  const len = 2;
  let lo = 0;
  let band = 0;
  put(end - len, at(len), (x) => {
    const k = x / len;
    const n = rnd();
    const cut = 0.01 + 0.5 * k * k;
    lo += cut * (n - lo);
    band += 0.5 * (lo - band);
    return ((lo - band) * 2 + Math.sin(TAU * (180 + 700 * k * k) * x) * 0.08) * k ** 2.2;
  }, 0.3, 0.3, 0.3);
}
for (const t of IMPACTS) {
  const big = t !== 4;
  let ph = 0;
  let lp = 0;
  put(t, at(2.2), (x) => {
    ph += (TAU * (30 + 60 * Math.exp(-x * 6))) / SR;
    const n = rnd();
    lp += 0.08 * (n - lp);
    return Math.sin(ph) * Math.exp(-x * 2.2) + lp * 3 * Math.exp(-x * 9);
  }, big ? 0.75 : 0.5, big ? 0.75 : 0.5, 0.5);
}
for (const t of CUTS) {
  if (IMPACTS.includes(t)) continue;
  let lp = 0;
  let band = 0;
  put(t - 0.18, at(0.4), (x) => {
    const k = x / 0.4;
    const n = rnd();
    lp += (0.45 - 0.4 * k) * (n - lp);
    band += 0.3 * (lp - band);
    return (lp - band) * Math.sin(Math.PI * k) ** 2;
  }, 0.22, 0.28, 0.2);
}
BLIPS.forEach((t, j) => {
  const f = [1320, 1480, 1660, 1760, 1980][j % 5];
  put(t, at(0.12), (x) => (Math.sin(TAU * f * x) + 0.4 * Math.sin(TAU * f * 2 * x)) * Math.exp(-x * 38), 0.1, 0.1, 0.25);
});

/* ---------------- reverb on the send bus (Schroeder) */
function reverb(input, combs, allpasses) {
  const out = new Float32Array(N);
  for (const [d, g] of combs) {
    const buf = new Float32Array(d);
    let i = 0;
    let lp = 0;
    for (let n = 0; n < N; n++) {
      const y = buf[i];
      lp += 0.4 * (y - lp);
      buf[i] = input[n] + lp * g;
      out[n] += y;
      i = (i + 1) % d;
    }
  }
  for (const [d, g] of allpasses) {
    const buf = new Float32Array(d);
    let i = 0;
    for (let n = 0; n < N; n++) {
      const b = buf[i];
      const y = -out[n] * g + b;
      buf[i] = out[n] + b * g;
      out[n] = y;
      i = (i + 1) % d;
    }
  }
  return out;
}
const revL = reverb(SEND, [[1557, 0.86], [1617, 0.85], [1491, 0.87], [1422, 0.86]], [[225, 0.5], [556, 0.5]]);
const revR = reverb(SEND, [[1580, 0.86], [1640, 0.85], [1514, 0.87], [1445, 0.86]], [[248, 0.5], [579, 0.5]]);

/* ---------------- master */
function prog(t, a, b) {
  return Math.min(1, Math.max(0, (t - a) / (b - a)));
}
let peak = 0;
for (let n = 0; n < N; n++) {
  const t = n / SR;
  const fade = Math.min(1, t / 0.05) * (1 - prog(t, DURATION - 1.2, DURATION));
  L[n] = Math.tanh((L[n] + revL[n] * 0.09) * 1.1) * fade;
  R[n] = Math.tanh((R[n] + revR[n] * 0.09) * 1.1) * fade;
  peak = Math.max(peak, Math.abs(L[n]), Math.abs(R[n]));
}
const gain = 0.9 / peak;
const pcm = Buffer.alloc(44 + N * 4);
pcm.write('RIFF', 0);
pcm.writeUInt32LE(36 + N * 4, 4);
pcm.write('WAVEfmt ', 8);
pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(SR, 24);
pcm.writeUInt32LE(SR * 4, 28);
pcm.writeUInt16LE(4, 32);
pcm.writeUInt16LE(16, 34);
pcm.write('data', 36);
pcm.writeUInt32LE(N * 4, 40);
for (let n = 0; n < N; n++) {
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[n] * gain)) * 32767), 44 + n * 4);
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[n] * gain)) * 32767), 46 + n * 4);
}
const out = new URL('./out/', import.meta.url).pathname;
await mkdir(out, { recursive: true });
await writeFile(`${out}score.wav`, pcm);
console.log(`${out}score.wav · ${DURATION}s · peak gain ${gain.toFixed(2)}`);
