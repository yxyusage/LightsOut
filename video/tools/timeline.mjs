/**
 * 时间轴工具：按《AI 视频制作手册》§7.1 的语速模型，从 cues.json 推导每句字幕的起止时间。
 *
 * 语速模型（手册实测值，不是估计）：
 *   中文 4.3 字/秒 · 句间换气 0.18 秒 · 单句最短 1.5 秒
 *   dur = max(1.5, 非空白字符数 / 4.3)
 *
 * 关键校验（手册靠这条抓出过一个真 bug）：
 *   end 不能超过片长，也不能压到下一句的 start。
 */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const CUES_PATH = join(here, "..", "assets", "cues.json");

export async function loadCues(path = CUES_PATH) {
  return JSON.parse(await readFile(path, "utf8"));
}

/** 非空白字符数：标点计入（天然留出停顿）；英文按字符计（手册明确要求） */
export function countChars(text) {
  return [...String(text)].filter((ch) => !/\s/u.test(ch)).length;
}

/**
 * 把一支片子的 cues 数组铺成带时间码的字幕行。
 * @returns {{lines: Array, totalSeconds: number, warnings: string[]}}
 */
export function buildTimeline(shot, config) {
  const { charsPerSecond, gapSeconds, minCueSeconds } = config;
  const lines = [];
  const warnings = [];
  let cursor = 0.35; // 开场留一点呼吸

  for (const [index, text] of shot.cues.entries()) {
    const chars = countChars(text);
    const duration = Math.max(minCueSeconds, chars / charsPerSecond);
    const start = cursor;
    const end = start + duration;
    lines.push({ index, text, chars, start, end, duration });
    cursor = end + gapSeconds;
  }

  const totalSeconds = lines.length ? lines[lines.length - 1].end + 0.6 : 0;
  return { lines, totalSeconds, warnings };
}

/** 全套校验：片长是否装得下、句间是否重叠、单句是否过短 */
export function validateShot(shot, config, declaredDuration) {
  const { lines, totalSeconds } = buildTimeline(shot, config);
  const problems = [];

  if (declaredDuration && totalSeconds > declaredDuration) {
    problems.push(
      `片长 ${declaredDuration.toFixed(1)}s 装不下口播（需要 ${totalSeconds.toFixed(2)}s）—— 手册 §7.1 就是靠这条抓到过真 bug`,
    );
  }
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].start < lines[i - 1].end) {
      problems.push(`第 ${i + 1} 句的起点压到了上一句的终点`);
    }
  }
  return { lines, totalSeconds, problems };
}
