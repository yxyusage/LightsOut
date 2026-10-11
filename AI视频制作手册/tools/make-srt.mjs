/**
 * Generate one SRT per video from assets/cues.json using the same timing maths
 * as the on-screen subtitle engine (中文 4.3 字/秒, 0.18s 换气).
 * Warns when a line is physically too long for its slot.
 *
 *   node tools/make-srt.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const cfg = JSON.parse(readFileSync('assets/cues.json', 'utf8'));
const CPS = cfg.charsPerSecond || 4.3;
const GAP = 0.18;
mkdirSync('renders', { recursive: true });

const pad = (n) => String(n).padStart(2, '0');
const stamp = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60), ms = Math.round((s - Math.floor(s)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(sec)},${String(ms).padStart(3, '0')}`;
};

let warns = 0;
for (const v of cfg.videos) {
  const rows = v.cues.map((c, i) => {
    const len = c.text.replace(/\s/g, '').length;
    const dur = Math.max(1.5, +(len / CPS).toFixed(2));
    const end = +(c.t + dur).toFixed(2);
    const next = v.cues[i + 1];
    if (next && next.t < end + GAP) {
      console.log(`  ⚠ ${v.name} 第 ${i + 1} 句语速偏快：需 ${dur}s，slot ${(next.t - c.t).toFixed(2)}s`);
      warns++;
    }
    if (end > v.duration) {
      console.log(`  ⚠ ${v.name} 第 ${i + 1} 句超出片长 ${v.duration}s（end ${end}s）`);
      warns++;
    }
    return { i: i + 1, start: c.t, end, text: c.text, len, dur };
  });

  const srt = rows.map((r) => `${r.i}\n${stamp(r.start)} --> ${stamp(r.end)}\n${r.text}\n`).join('\n');
  writeFileSync(`renders/${v.name}.srt`, srt, 'utf8');
  const last = rows[rows.length - 1];
  console.log(`${v.name}.srt   ${rows.length} 句 · 末句收在 ${last.end}s · 片长 ${v.duration}s`);
}
console.log(warns ? `\n${warns} 条警告` : '\n口播节奏检查通过：所有字幕都在 slot 内');
