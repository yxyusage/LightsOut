#!/usr/bin/env node
/**
 * 仓库静态检查。
 *
 * 这些检查针对的都是"人眼容易漏、CI 能挡住"的问题：
 *
 *  1. **模块解析** —— 每个相对 import 是否真的指向存在的文件。
 *     这类错误在浏览器里只会表现为一个白屏加一条控制台报错，本地很难第一时间发现。
 *  2. **可注入时钟不变量** —— packages/core 里不允许出现"直接读系统时间"的代码。
 *     这是整个核心层可测试性的基础，必须由机器守住（见 docs/ARCHITECTURE.md）。
 *  3. **Markdown 相对链接** —— 文档里指向的文件是否真的存在。
 *     文档最容易在重构后悄悄失效。
 *  4. **Service Worker 预缓存清单** —— 清单里的每个资源必须真实存在。
 *     写错文件名不会让安装报错，却会让熄灯界面在断网时打不开，
 *     而「断网」正是用户最容易用来绕过熄灯的手段。
 *  5. **文本文件卫生** —— LF 换行、文件末尾有换行、行尾无空白。
 *     跨平台协作时这些差异会制造大量无意义的 diff。
 *
 * 用法：node scripts/check.mjs
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "bin", "obj", ".scratch", ".gradle", "build"]);
const TEXT_EXT = new Set([".js", ".mjs", ".json", ".css", ".html", ".md", ".yml", ".yaml", ".txt", ".webmanifest", ".cs", ".kt", ".kts", ".xml", ".py", ".gitignore", ".editorconfig"]);
const CODE_EXT = new Set([".js", ".mjs"]);

/**
 * 由其它工具生成的产物，其换行符取决于宿主操作系统（例如 .NET 在 Windows 上写出的报告是 CRLF）。
 * 强行要求它们统一为 LF 既做不到、也没有意义，因此从文本卫生检查中排除。
 * 注意：这些文件仍受 .gitattributes 的 eol=lf 约束，入库版本依然是 LF。
 */
const GENERATED_FILES = new Set(["selftest-report.txt"]);

const problems = [];
const notes = [];

function fail(file, message) {
  problems.push(`${file}: ${message}`);
}

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".github" && entry.name !== ".gitignore" && entry.name !== ".editorconfig") {
      if (entry.isDirectory()) continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

/* ───────────── 1. 文本文件卫生 ───────────── */

async function checkTextHygiene(files) {
  for (const file of files) {
    const ext = extname(file);
    const base = file.split(/[/\\]/).pop();
    if (!TEXT_EXT.has(ext) && !TEXT_EXT.has(base)) continue;
    if (GENERATED_FILES.has(base)) continue;

    const buffer = await readFile(file);
    const relative = file.replace(repoRoot, ".");

    // 二进制文件（含 NUL 字节）跳过
    if (buffer.includes(0)) continue;

    const text = buffer.toString("utf8");

    if (text.includes("\r\n")) fail(relative, "包含 CRLF 换行，本仓库统一使用 LF（见 .editorconfig）");
    if (text.length > 0 && !text.endsWith("\n")) fail(relative, "文件末尾缺少换行");
    // Markdown 里的行尾双空格是有意义的换行语法，因此豁免
    if (ext !== ".md") {
      for (const [index, line] of text.split("\n").entries()) {
        if (/[ \t]+$/.test(line)) {
          fail(relative, `第 ${index + 1} 行有行尾空白`);
          break;
        }
      }
    }
  }
}

/* ───────────── 2. 相对 import 必须能解析 ───────────── */

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

async function checkModuleResolution(files) {
  for (const file of files) {
    if (!CODE_EXT.has(extname(file))) continue;
    const relative = file.replace(repoRoot, ".");
    const content = await readFile(file, "utf8");

    for (const match of content.matchAll(IMPORT_RE)) {
      const specifier = match[1] ?? match[2];
      if (!specifier) continue;
      // 只检查相对路径；node: 内置模块与裸包名不在范围内
      if (!specifier.startsWith(".") && !specifier.startsWith("/")) continue;

      const target = resolve(dirname(file), specifier);
      if (!(await exists(target))) {
        fail(relative, `import 指向的文件不存在：${specifier}`);
      }
    }
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/* ───────────── 3. Markdown 相对链接必须能解析 ───────────── */

const LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

async function checkMarkdownLinks(files) {
  for (const file of files) {
    if (extname(file) !== ".md") continue;
    const relative = file.replace(repoRoot, ".");
    const content = await readFile(file, "utf8");

    for (const match of content.matchAll(LINK_RE)) {
      const target = match[1].trim();
      // 跳过外链、锚点与邮件链接
      if (/^(https?:|mailto:|tel:|#)/i.test(target)) continue;
      // 去掉锚点后再解析
      const pathPart = target.split("#")[0];
      if (!pathPart) continue;

      const resolved = resolve(dirname(file), decodeURIComponent(pathPart));
      if (!(await exists(resolved))) {
        fail(relative, `相对链接指向的文件不存在：${target}`);
      }
    }
  }
}

/* ───────────── 4. Service Worker 预缓存清单必须真实存在 ───────────── */

/**
 * «sw.js» 里的 APP_SHELL 是**离线可用**的唯一保障。
 * 写错一个文件名不会让安装失败（安装时用 Promise.allSettled 容错），
 * 但会导致该资源在离线时 404 —— 熄灯界面在断网时打不开，
 * 而「断网」恰恰是用户最可能用来绕过熄灯的手段。所以必须由检查脚本守住。
 *
 * 路径映射：清单里写的是**发布产物（dist）**的路径，因此要映射回源码位置。
 *   ./            → apps/web/index.html
 *   ./src/…       → apps/web/src/…
 *   ./assets/…    → apps/web/assets/…
 *   ./core/…      → packages/core/…
 */
async function checkServiceWorkerShell() {
  const swPath = join(repoRoot, "apps", "web", "sw.js");
  if (!(await exists(swPath))) return;
  const relative = swPath.replace(repoRoot, ".");
  const content = await readFile(swPath, "utf8");

  const arrayMatch = /const\s+APP_SHELL\s*=\s*\[([\s\S]*?)\]/.exec(content);
  if (!arrayMatch) {
    fail(relative, "找不到 APP_SHELL 数组，检查脚本需要同步更新");
    return;
  }

  const entries = [...arrayMatch[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  if (entries.length === 0) {
    fail(relative, "APP_SHELL 为空");
    return;
  }

  for (const entry of entries) {
    const clean = entry.replace(/^\.\//, "");
    let sourcePath;
    if (clean === "" || clean === "index.html") sourcePath = join(repoRoot, "apps", "web", "index.html");
    else if (clean.startsWith("core/")) sourcePath = join(repoRoot, "packages", "core", clean.slice("core/".length));
    else sourcePath = join(repoRoot, "apps", "web", clean);

    if (!(await exists(sourcePath))) {
      fail(relative, `APP_SHELL 中的 "${entry}" 在源码中不存在（解析为 ${sourcePath.replace(repoRoot, ".")}）`);
    }
  }

  // 反向校验：应用会加载的**每一个** JS 模块都必须出现在清单里。
  //
  // 只校验"清单里的都存在"是不够的。新增一个模块却忘了加进 APP_SHELL，
  // 后果是**离线时整个应用打不开** —— 模块 404 会让入口的 import 链直接断掉。
  // 而联网开发时完全看不出来，所以必须由检查脚本守住。
  // 本项目真的漏过 ./core/src/sleep.js。
  const listed = new Set(entries.map((entry) => entry.replace(/^\.\//, "")));
  const moduleRoots = [
    { sourceDir: join(repoRoot, "apps", "web", "src"), sourcePrefix: "apps/web/src", listedPrefix: "src" },
    { sourceDir: join(repoRoot, "packages", "core", "src"), sourcePrefix: "packages/core/src", listedPrefix: "core/src" },
  ];

  for (const { sourceDir, sourcePrefix, listedPrefix } of moduleRoots) {
    for (const file of await walk(sourceDir)) {
      if (extname(file) !== ".js") continue;
      const rel = file.replace(repoRoot, "").replace(/\\/g, "/").replace(/^\//, "");
      const listedPath = `${listedPrefix}/${rel.slice(sourcePrefix.length + 1)}`;
      if (!listed.has(listedPath)) {
        fail(relative, `模块 ${rel} 没有被 APP_SHELL 预缓存 —— 离线时应用会打不开`);
      }
    }
  }

  notes.push(`已校验 Service Worker 预缓存的 ${entries.length} 个资源全部存在，且所有应用模块都已被预缓存`);
}

/* ───────────── 5. 核心层不得直接读取系统时间 ───────────── */

/**
 * 允许的写法只有一种：作为工厂函数的**默认参数**注入，即 `now = () => new Date()`。
 * 这类写法把时钟暴露成可替换的依赖，测试可以任意穿越时间。
 * 任何其它形式的直接读取都会让熄灯判定无法被测试，必须拦下。
 */
const TIME_READ_RE = /new Date\(\s*\)|Date\.now\(\s*\)/;
/**
 * 判定"注入式默认参数"的依据：时间读取之前先出现了一个箭头函数。
 * 这样 `now = () => new Date()` 与
 * `monotonic = () => (typeof performance !== "undefined" ? performance.now() : Date.now())`
 * 都能被正确识别为"把时钟暴露成依赖"，而 `const t = new Date()` 这类仍会被拦下。
 */
const ARROW_BEFORE_RE = /\([^()]*\)\s*=>/;
const ANNOTATION = "@injectable-clock";

async function checkInjectableClock(files) {
  const coreDir = join(repoRoot, "packages", "core", "src");
  let scanned = 0;

  for (const file of files) {
    if (!file.startsWith(coreDir)) continue;
    if (!CODE_EXT.has(extname(file))) continue;
    scanned += 1;

    const relative = file.replace(repoRoot, ".");
    const content = await readFile(file, "utf8");
    const lines = content.split("\n");

    for (const [index, line] of lines.entries()) {
      const timeRead = TIME_READ_RE.exec(line);
      if (!timeRead) continue;
      // 注释行不算
      if (/^\s*(\*|\/\/)/.test(line)) continue;
      // 时间读取之前出现了箭头函数 → 说明这是注入式默认参数
      const arrow = ARROW_BEFORE_RE.exec(line);
      if (arrow && arrow.index < timeRead.index) continue;
      // 允许显式标注（用于确实无法注入的极端情况，需在同行注明理由）
      if (line.includes(ANNOTATION)) continue;

      fail(
        relative,
        `第 ${index + 1} 行直接读取了系统时间。核心层必须通过参数注入时钟，` +
          `否则熄灯判定无法在测试中穿越时间。写法应为：now = () => new Date()`,
      );
    }
  }

  if (scanned === 0) fail("packages/core/src", "没有扫描到任何核心源文件，检查脚本可能失效了");
  notes.push(`已扫描 ${scanned} 个核心源文件，确认时钟均为注入式`);
}

/* ───────────── 主流程 ───────────── */

async function main() {
  const files = await walk(repoRoot);
  notes.push(`共扫描 ${files.length} 个文件`);

  await checkTextHygiene(files);
  await checkModuleResolution(files);
  await checkMarkdownLinks(files);
  await checkServiceWorkerShell();
  await checkInjectableClock(files);

  console.log("熄灯早睡 · 静态检查");
  for (const note of notes) console.log(`  · ${note}`);

  if (problems.length === 0) {
    console.log("  ✓ 全部通过");
    return;
  }

  console.error(`\n  ✗ 发现 ${problems.length} 个问题：`);
  for (const problem of problems) console.error(`    - ${problem}`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("检查脚本自身出错：", error);
  process.exitCode = 1;
});
