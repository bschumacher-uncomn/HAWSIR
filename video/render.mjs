// Renders video/hype.html frame by frame into an H.264 MP4 with the generated score.
// usage:
//   node video/render.mjs                      full render → video/out/navifi_hype.mp4
//   node video/render.mjs --at 1.5,9,21.2      preview frames → video/out/preview/
//   node video/render.mjs --from 20 --to 30    render a section only (silent)
import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';
import { DURATION, FPS } from './timeline.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = new URL('./out/', import.meta.url).pathname;
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file) || !(await stat(file)).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'max-age=3600' });
  createReadStream(file).pipe(res);
}).listen(0);
const port = server.address().port;

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  userDataDir: '/tmp/navifi-video-render',
  args: ['--no-sandbox', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--hide-scrollbars', '--force-color-profile=srgb'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('[page]', e.message));
page.on('console', (m) => m.type() === 'error' && console.error('[console]', m.text()));
await page.goto(`http://localhost:${port}/video/hype.html`, { waitUntil: 'networkidle0', timeout: 120000 });
await page.evaluate(() => window.__ready);
const cdp = await page.createCDPSession();
const grab = async (t, format = 'jpeg') => {
  await page.evaluate((x) => window.renderFrame(x), t);
  const { data } = await cdp.send('Page.captureScreenshot', { format, quality: format === 'jpeg' ? 95 : undefined, optimizeForSpeed: true });
  return Buffer.from(data, 'base64');
};

if (args.at) {
  await mkdir(`${OUT}preview`, { recursive: true });
  for (const t of args.at.split(',').map(Number)) {
    const file = `${OUT}preview/t${t.toFixed(2).padStart(6, '0')}.jpg`;
    await writeFile(file, await grab(t));
    console.log(file);
  }
} else {
  await mkdir(OUT, { recursive: true });
  const from = Number(args.from ?? 0);
  const to = Number(args.to ?? DURATION);
  const section = args.from || args.to;
  const out = args.out ?? `${OUT}${section ? `section_${from}-${to}` : 'navifi_hype'}.mp4`;
  const score = `${OUT}score.wav`;
  const withAudio = !section && existsSync(score);
  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    ...(withAudio ? ['-i', score] : []),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-tune', 'animation',
    ...(withAudio ? ['-c:a', 'aac', '-b:a', '256k', '-shortest'] : []),
    '-movflags', '+faststart', out,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const n = Math.round((to - from) * FPS);
  const began = Date.now();
  for (let i = 0; i < n; i++) {
    const buf = await grab(from + i / FPS);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 150 === 0) console.log(`frame ${i}/${n} · ${((Date.now() - began) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log(out, withAudio ? '(with score)' : '(silent)');
}
await browser.close();
server.close();
