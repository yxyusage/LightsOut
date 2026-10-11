/**
 * 把封面 HTML 截成图片（无头 Chrome + CDP，无 npm 依赖）。
 *   node tools/shoot-cover.mjs cover/cover-4x3.html 1600 1200 2
 * 参数：HTML 路径 · 宽 · 高 · 像素密度
 */
import { spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9441;
const file = path.resolve(process.argv[2] || 'cover/cover-4x3.html');
const W = Number(process.argv[3] || 1600);
const H = Number(process.argv[4] || 1200);
const DPR = Number(process.argv[5] || 2);
const out = file.replace(/\.html$/, `@${DPR}x.png`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = async (u) => (await fetch(u)).json();

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } }); }
  send(method, params = {}) { const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej })); }
  static async connect(url) { const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true }); }); return new CDP(ws); }
}

const profile = `/tmp/cover-profile-${PORT}`;
rmSync(profile, { recursive: true, force: true });
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless', '--disable-gpu',
  '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1', '--allow-file-access-from-files',
  `--user-data-dir=${profile}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });

let cdp;
try {
  for (let i = 0; i < 120; i++) {
    try { await getJSON(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(250); }
  }
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('file://' + file)}`, { method: 'PUT' });
  cdp = await CDP.connect((await r.json()).webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
  await cdp.send('Page.navigate', { url: 'file://' + file });
  await sleep(1600);   // 等字体与图片就绪
  const ready = await cdp.send('Runtime.evaluate', {
    expression: `(async () => { await document.fonts.ready;
      const imgs = [...document.images];
      await Promise.all(imgs.map(i => i.complete ? 1 : new Promise(r => { i.onload = i.onerror = r; })));
      return imgs.length + ' images / ' + document.fonts.size + ' font faces'; })()`,
    awaitPromise: true, returnByValue: true,
  });
  console.log('  ready:', ready.result.value);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`  ${out}  (${W * DPR}x${H * DPR})`);
} finally {
  try { cdp?.ws.close(); } catch {}
  chrome.kill('SIGKILL');
}
