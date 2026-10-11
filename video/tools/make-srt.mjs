#!/usr/bin/env node
/**
 * 生成 SRT 字幕与字幕总表 txt。
 * 思路沿用《AI 视频制作手册》§7.2：画面字幕、SRT、总表三者同源。
 *
 * 用法：node video/tools/make-srt.mjs [--check]
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTimeline, loadCues } from "./timeline.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "..", "renders");
const checkOnly = process.argv.includes("--check");

function srtTime(seconds) {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

const config = await loadCues();

let grandTotal = 0;
let offset = 0;
const srtBlocks = [];
const report = [];
const allProblems = [];

report.push(`熄灯早睡 · 作品介绍视频 —— 字幕时间轴`);
report.push(`语速模型：${config.charsPerSecond} 字/秒 · 句间 ${config.gapSeconds}s · 单句最短 ${config.minCueSeconds}s`);
report.push("");

let index = 1;
for (const shot of config.shots) {
  const { lines, totalSeconds } = buildTimeline(shot, config);
  grandTotal += totalSeconds + 0.35;
  report.push(`── ${shot.id} ${shot.name} ──  片长 ${totalSeconds.toFixed(2)}s`);
  for (const line of lines) {
    report.push(`   [${srtTime(offset + line.start)} → ${srtTime(offset + line.end)}] ${line.text}   (${line.chars} 字 / ${line.duration.toFixed(2)}s)`);
    srtBlocks.push(`${index++}\n${srtTime(offset + line.start)} --> ${srtTime(offset + line.end)}\n${line.text}`);
  }
  report.push("");
  offset += totalSeconds + 0.35;
}

report.push("── 连读文本（配音照念，一行一句）──");
for (const shot of config.shots) {
  report.push(`${shot.id} ${shot.cues.join("")}`);
}
report.push("");
report.push(`合计时长：约 ${grandTotal.toFixed(1)} 秒`);

console.log(report.join("\n"));

if (allProblems.length) {
  console.error("\n字幕校验失败：");
  for (const p of allProblems) console.error("  - " + p);
  process.exitCode = 1;
}

if (!checkOnly) {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "熄灯早睡-字幕.srt"), srtBlocks.join("\n\n") + "\n", "utf8");
  await writeFile(join(OUT_DIR, "字幕总表.txt"), report.join("\n") + "\n", "utf8");
  console.log(`\n已写出：${OUT_DIR}\\熄灯早睡-字幕.srt`);
  console.log(`已写出：${OUT_DIR}\\字幕总表.txt`);
}
