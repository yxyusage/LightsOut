#!/usr/bin/env node
/**
 * 构建 Web/PWA 发布产物。
 *
 * 本项目的应用代码**本身不需要构建**（原生 ES Module、零依赖、零转译）。
 * 这个脚本只做一件事：把分处两个目录的代码拼成一个自包含、可直接托管的静态站点，
 * 并把跨目录的相对引用改写为发布后的路径。
 *
 * 目录映射：
 *   apps/web/*            → dist/*
 *   packages/core/*       → dist/core/*
 *   src/core.js 的 import 由 ../../../packages/core/src/index.js 改为 ../core/src/index.js
 *
 * 用法：node scripts/build.mjs
 */

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(repoRoot, "apps", "web");
const coreDir = join(repoRoot, "packages", "core");
const distDir = join(repoRoot, "dist");

const PACKAGE_IMPORT = "../../../packages/core/src/index.js";
const DIST_IMPORT = "../core/src/index.js";

async function main() {
  if (!existsSync(webDir)) throw new Error(`找不到 Web 应用目录：${webDir}`);
  if (!existsSync(coreDir)) throw new Error(`找不到核心包目录：${coreDir}`);

  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  // 1. 应用外壳
  await cp(webDir, distDir, { recursive: true, filter: (source) => !source.includes(`${"node_modules"}`) });

  // 2. 核心包
  await cp(coreDir, join(distDir, "core"), { recursive: true });

  // 3. 改写核心引用（只改这一个文件，所以这里是唯一需要维护的映射点）
  const shimPath = join(distDir, "src", "core.js");
  const original = await readFile(shimPath, "utf8");
  if (!original.includes(PACKAGE_IMPORT)) {
    throw new Error(
      `src/core.js 中未找到预期的引用路径 "${PACKAGE_IMPORT}"，\n` +
        "如果核心包位置变了，请同步更新 scripts/build.mjs 里的常量。",
    );
  }
  await writeFile(shimPath, original.replace(PACKAGE_IMPORT, DIST_IMPORT), "utf8");

  // 4. 核对发布产物里不会再引用仓库内的相对路径
  const leaked = await findLeakedPackageImports(distDir);
  if (leaked.length) {
    throw new Error(`发布产物中仍残留仓库内路径引用：\n${leaked.join("\n")}`);
  }

  console.log("构建完成 →", distDir);
  console.log("用 `node scripts/serve.mjs dist` 本地预览，或把 dist/ 整个目录上传到任意静态托管。");
}

/**
 * 递归扫描是否残留指向仓库源码的 **import 说明符**。
 *
 * 注意只匹配 import / export 语句里的字符串，而不是无脑搜 "packages/core"：
 * 源码注释里提到 "packages/core" 是完全正常的，误报会让构建变得不可信。
 */
const LEAKED_SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*["'`][^"'`]*packages\/core[^"'`]*["'`]/;

async function findLeakedPackageImports(dir) {
  const { readdir } = await import("node:fs/promises");
  const hits = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      hits.push(...(await findLeakedPackageImports(full)));
      continue;
    }
    if (!/\.(js|mjs|html)$/.test(entry.name)) continue;
    const content = await readFile(full, "utf8");
    if (LEAKED_SPECIFIER.test(content)) hits.push(full.replace(repoRoot, "."));
  }
  return hits;
}

main().catch((error) => {
  console.error("构建失败：", error.message);
  process.exitCode = 1;
});
