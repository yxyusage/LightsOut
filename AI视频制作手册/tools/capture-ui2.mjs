/**
 * Pass 2: theme/palette variants (forced real reload) + interaction states
 * (tab switches, dialogs) so the video can cut between genuine screens.
 *
 *   node tools/capture-ui2.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9434;
const BASE = 'http://127.0.0.1:8123';
const W = 1600, H = 900, DPR = 2;
const OUT = path.resolve('assets/ui');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = async (u) => (await fetch(u)).json();

const clickText = (txt) => `(() => {
  const all = [...document.querySelectorAll('button, .el-tabs__item, a, .el-radio-button__inner, .el-select')];
  const el = all.find(e => (e.textContent || '').trim().includes(${JSON.stringify(txt)}));
  if (!el) return 'NOT_FOUND';
  el.click();
  return 'clicked:' + (el.textContent || '').trim().slice(0, 24);
})()`;

const SHOTS = [
  // --- theme / palette variants (real reload via a unique query string) ---
  { name: 'home-dark',      route: '/#/',     theme: 'dark',  wait: 2000 },
  { name: 'stats-dark',     route: '/#/stats',theme: 'dark',  wait: 3000 },
  { name: 'note-dark',      route: '/#/note/2', theme: 'dark', wait: 3000 },
  { name: 'home-ocean',     route: '/#/',     palette: 'ocean',  wait: 2000 },
  { name: 'home-sunset',    route: '/#/',     palette: 'sunset', wait: 2000 },
  // --- interaction states ---
  { name: 'note-mindmap',   route: '/#/note/2', wait: 2600, steps: [clickText('思维导图')], after: 2600 },
  { name: 'note-formulas',  route: '/#/note/2', wait: 2600, steps: [clickText('公式板书')], after: 2200 },
  { name: 'note-chat',      route: '/#/note/2', wait: 2600, steps: [clickText('AI 答疑')],  after: 1800 },
  { name: 'config-model',   route: '/#/config', wait: 2400, steps: [clickText('deepseek')], after: 1200 },
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

const profile = `/tmp/blui2-profile-${PORT}`;
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
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + '/')}`, { method: 'PUT' });
  const target = await res.json();
  cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });

  let n = 0;
  for (const s of SHOTS) {
    // a unique path segment forces a genuine document load, so theme + palette are re-read at boot
    const hash = s.route.slice(1);            // '#/stats'
    const url = `${BASE}/?shot=${++n}${hash}`;
    await cdp.send('Page.navigate', { url });
    await sleep(600);
    await cdp.send('Runtime.evaluate', {
      expression: `localStorage.setItem('bililearn-theme', ${JSON.stringify(s.theme || 'light')});
                   localStorage.setItem('bililearn-palette', ${JSON.stringify(s.palette || 'paper')}); true`,
    });
    await cdp.send('Page.navigate', { url: url + '&r=1' });
    await sleep(s.wait);

    for (const step of s.steps || []) {
      const r = await cdp.send('Runtime.evaluate', { expression: step, returnByValue: true });
      console.log(`   step → ${r.result.value}`);
      await sleep(s.after || 1200);
    }
    await cdp.send('Runtime.evaluate', { expression: 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))', awaitPromise: true });

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    writeFileSync(path.join(OUT, `${s.name}.png`), Buffer.from(shot.data, 'base64'));
    console.log(`  ${s.name}`);
  }
  console.log(`\ndone → ${OUT}`);
} finally {
  try { cdp?.ws.close(); } catch {}
  chrome.kill('SIGKILL');
}
