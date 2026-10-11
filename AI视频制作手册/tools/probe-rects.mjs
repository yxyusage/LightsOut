/**
 * Probe the exact bounding boxes of the interface controls the promo needs to
 * point at, so the animated mouse cursor lands on the real buttons.
 * Coordinates are CSS px at a 1600x900 viewport; the screenshots are 2x, so
 * multiply by 2 when mapping onto the captured PNG.
 *
 *   node tools/probe-rects.mjs   →  assets/rects.json
 */
import { spawn } from 'node:child_process';
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9435;
const BASE = 'http://127.0.0.1:8123';
const W = 1600, H = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = async (u) => (await fetch(u)).json();

const findRects = (labels) => `(() => {
  const labels = ${JSON.stringify(labels)};
  const out = {};
  const all = [...document.querySelectorAll('button, a, input, .el-tabs__item, .el-radio-button__inner, .el-card, .el-tag, div, span, h2, h3')];
  for (const label of labels) {
    let best = null;
    for (const el of all) {
      const t = (el.textContent || '').trim();
      const ph = el.getAttribute && (el.getAttribute('placeholder') || '');
      const hit = t === label || (t.includes(label) && t.length <= label.length + 14) || ph.includes(label);
      if (!hit) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.width > 1500) continue;
      const area = r.width * r.height;
      if (!best || area < best._area) best = { x: r.x, y: r.y, w: r.width, h: r.height, _area: area };
    }
    if (best) { delete best._area; out[label] = best; }
  }
  return JSON.stringify(out);
})()`;

const PAGES = [
  { name: 'home', route: '/#/', wait: 2400, labels: [
      '解析视频', '例如：https://www.bilibili.com/video', '课程类型', '通用', '英语', '数理', '计算机', '文科',
      '视频输入 → 笔记生成 → 自测检验 → 薄弱复盘 → 体系化复习', '最近笔记', '查看全部 →',
      '路线图', '收藏夹', '全链路时间戳', '分学科模板', '学习闭环', '学习数据' ] },
  { name: 'note', route: '/#/note/2', wait: 3200, labels: [
      '笔记', '思维导图', '公式板书', '复盘', '导出 Markdown', '导出 PDF', '导出 Word', '导出 XMind',
      'AI 答疑', '去历史笔记查看', '生成复盘分析', '重新生成', '已学完', '学习中', '未学',
      '外部推进式开发概念与提示策略', '00:02:02' ] },
  { name: 'stats', route: '/#/stats', wait: 3200, labels: [
      '已生成笔记', '未掌握错题', '今日待复习', '已逾期', '近 14 天笔记生成', '笔记学科分布', '错题掌握状态', '最近笔记' ] },
  { name: 'review', route: '/#/review', wait: 2400, labels: ['今日待复习（含逾期）', '未掌握错题', '已完成复习', '复习计划', '错题本', '刷新'] },
  { name: 'history', route: '/#/history', wait: 2400, labels: ['历史笔记', '搜索', '通用', '计算机'] },
];

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

const profile = `/tmp/blrects-${PORT}`;
rmSync(profile, { recursive: true, force: true });
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless', '--disable-gpu', '--no-sandbox',
  '--hide-scrollbars', `--user-data-dir=${profile}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });

let cdp;
try {
  for (let i = 0; i < 120; i++) { try { await getJSON(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(250); } }
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + '/')}`, { method: 'PUT' });
  cdp = await CDP.connect((await r.json()).webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Runtime.evaluate', { expression: `localStorage.setItem('bililearn-theme','light');localStorage.setItem('bililearn-palette','paper');true` });

  const result = {};
  let n = 0;
  for (const p of PAGES) {
    const hash = p.route.slice(1);
    await cdp.send('Page.navigate', { url: `${BASE}/?p=${++n}${hash}` });
    await sleep(p.wait);
    const r = await cdp.send('Runtime.evaluate', { expression: findRects(p.labels), returnByValue: true });
    result[p.name] = JSON.parse(r.result.value);
    console.log(`${p.name}: ${Object.keys(result[p.name]).length}/${p.labels.length} located`);
  }
  mkdirSync('assets', { recursive: true });
  writeFileSync(path.resolve('assets/rects.json'), JSON.stringify(result, null, 2));
  console.log('\nwrote assets/rects.json');
} finally {
  try { cdp?.ws.close(); } catch {}
  chrome.kill('SIGKILL');
}
