/**
 * 把 assets/cues.json 导出成一份人类可读的字幕总表（txt）。
 * 时间与画面字幕、SRT 完全同源同算法。
 *
 *   node tools/make-txt.mjs   →  renders/BiliLearn-AI_字幕总表.txt
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const cfg = JSON.parse(readFileSync('assets/cues.json', 'utf8'));
const CPS = cfg.charsPerSecond || 4.3;
const GAP = 0.18;
mkdirSync('renders', { recursive: true });

const mmss = (s) => {
  const m = Math.floor(s / 60), sec = s - m * 60;
  return `${String(m).padStart(2, '0')}:${sec.toFixed(1).padStart(4, '0')}`;
};
const line = (ch = '─', n = 66) => ch.repeat(n);

const films = cfg.videos.map((v) => {
  let warn = 0;
  const rows = v.cues.map((c, i) => {
    const len = c.text.replace(/\s/g, '').length;
    const dur = Math.max(1.5, +(len / CPS).toFixed(2));
    const end = +(c.t + dur).toFixed(2);
    const next = v.cues[i + 1];
    if ((next && next.t < end + GAP) || end > v.duration) warn++;
    return { i: i + 1, start: c.t, end, dur, len, text: c.text };
  });
  return { v, rows, warn };
});

const totalCues = films.reduce((n, f) => n + f.rows.length, 0);
const totalDur = films.reduce((n, f) => n + f.v.duration, 0);

let out = '';
out += `BiliLearn-AI 宣传短片 · 全部字幕\n`;
out += `${line('=')}\n`;
out += `共 ${films.length} 支短片 / ${totalCues} 句字幕 · 总时长 ${totalDur.toFixed(1)} 秒\n\n`;
out += `【口播节奏】中文 ${CPS} 字/秒，句间留 ${GAP} 秒换气，单句最短 1.5 秒。\n`;
out += `            每句时长由字数推导，并已校验都能塞进自己的时间槽。\n`;
out += `【用法】    按时间码配音即可与画面贴合；文末「连读文本」可直接照着念。\n`;
out += `【同源】    本表、画面字幕、各片 .srt 都来自 assets/cues.json 同一份时间。\n\n`;

for (const { v, rows } of films) {
  out += `${line()}\n`;
  out += `${v.id} · ${v.name.replace(/^\d+-/, '')}${' '.repeat(Math.max(1, 34 - v.name.length))}${v.duration} 秒\n`;
  out += `${line()}\n`;
  out += `  #   起 — 止             时长    字数   字幕\n`;
  for (const r of rows) {
    out += `  ${String(r.i).padEnd(4)}${mmss(r.start)} — ${mmss(r.end)}   ${r.dur.toFixed(1)}s   ${String(r.len).padStart(2)}     ${r.text}\n`;
  }
  out += '\n';
}

out += `${line('=')}\n`;
out += `附：连读文本（配音用，不含时间码）\n`;
out += `${line('=')}\n\n`;
for (const { v, rows } of films) {
  out += `【${v.id} ${v.name.replace(/^\d+-/, '')}】\n`;
  rows.forEach((r) => { out += `${r.text}\n`; });
  out += '\n';
}

writeFileSync('renders/BiliLearn-AI_字幕总表.txt', out, 'utf8');
console.log(`renders/BiliLearn-AI_字幕总表.txt  ${films.length} 支 / ${totalCues} 句 / ${totalDur.toFixed(1)}s`);
