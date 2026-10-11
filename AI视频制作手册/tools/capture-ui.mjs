/**
 * Capture the real BiliLearn-AI interface as video assets.
 * Headless Chrome + DevTools Protocol, no npm dependencies (Node 22+ WebSocket).
 *
 *   node tools/capture-ui.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9433;
const BASE = 'http://127.0.0.1:8123';
const W = 1600;
const H = 900;          // 16:9, matches the video canvas
const DPR = 2;
const OUT = path.resolve('assets/ui');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = async (u) => (await fetch(u)).json();

/* pages worth showing, in the order the product story needs them */
const SHOTS = [
  { name: 'home',          route: '/#/',              wait: 2200 },
  { name: 'home-dark',     route: '/#/',              wait: 1800, theme: 'dark' },
  { name: 'note',          route: '/#/note/2',        wait: 3000 },
  { name: 'note2',         route: '/#/note/1',        wait: 3000 },
  { name: 'history',       route: '/#/history',       wait: 2200 },
  { name: 'stats',         route: '/#/stats',         wait: 3200 },
  { name: 'stats-dark',    route: '/#/stats',         wait: 2600, theme: 'dark' },
  { name: 'review',        route: '/#/review',        wait: 2400 },
  { name: 'collections',   route: '/#/collections',   wait: 2400 },
  { name: 'roadmap',       route: '/#/roadmap',       wait: 2400 },
  { name: 'favorites',     route: '/#/favorites',     wait: 2400 },
  { name: 'config',        route: '/#/config',        wait: 2200 },
  { name: 'config-dark',   route: '/#/config',        wait: 2000, theme: 'dark' },
  { name: 'home-ocean',    route: '/#/',              wait: 2000, palette: 'ocean' },
  { name: 'home-sunset',   route: '/#/',              wait: 2000, palette: 'sunset' },
];

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    return new CDP(ws);
  }
}

const profile = `/tmp/blui-profile-${PORT}`;
rmSync(profile, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless', '--disable-gpu', '--no-sandbox',
  '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1',
  `--user-data-dir=${profile}`, `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });

let cdp;
try {
  for (let i = 0; i < 120; i++) {
    try { await getJSON(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(250); }
  }
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + '/#/')}`, { method: 'PUT' });
  const target = await res.json();
  cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: DPR, mobile: false,
  });

  let currentTheme = 'light';
  let currentPalette = 'paper';
  for (const s of SHOTS) {
    // theme + palette are read from localStorage at boot, so set them then reload
    await cdp.send('Runtime.evaluate', {
      expression: `localStorage.setItem('bililearn-theme', ${JSON.stringify(s.theme || 'light')});
                   localStorage.setItem('bililearn-palette', ${JSON.stringify(s.palette || 'paper')});
                   true`,
    });
    currentTheme = s.theme || 'light';
    currentPalette = s.palette || 'paper';

    await cdp.send('Page.navigate', { url: BASE + s.route });
    await sleep(s.wait);
    // force a repaint settle: wait two frames
    await cdp.send('Runtime.evaluate', { expression: 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))', awaitPromise: true });

    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false,
    });
    const file = path.join(OUT, `${s.name}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log(`  ${s.name.padEnd(14)} ${s.route.padEnd(16)} ${currentTheme}/${currentPalette}`);
  }
  console.log(`\ncaptured ${SHOTS.length} screenshots at ${W * DPR}x${H * DPR} → ${OUT}`);
} finally {
  try { cdp?.ws.close(); } catch {}
  chrome.kill('SIGKILL');
}
