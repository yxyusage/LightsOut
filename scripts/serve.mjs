#!/usr/bin/env node
/**
 * 零依赖静态服务器。
 *
 * 用途：
 *  1. 本地预览 —— PWA 的 Service Worker 与「添加到主屏幕」都需要 http(s) 上下文，
 *     直接双击 index.html（file://）拿不到这些能力；
 *  2. **手机真机预览** —— 默认绑定 0.0.0.0，同一 Wi-Fi 下的手机可以直接访问。
 *
 * 用法：
 *   node scripts/serve.mjs            # 服务仓库根目录，入口跳转到 /apps/web/
 *   node scripts/serve.mjs dist       # 服务构建产物
 *   PORT=5199 node scripts/serve.mjs
 *   HOST=127.0.0.1 node scripts/serve.mjs   # 只允许本机访问
 *
 * ⚠️ 关于手机上的 PWA：局域网 http://192.168.x.x 属于**不安全上下文**，
 * 浏览器会拒绝注册 Service Worker 与 Wake Lock。界面与熄灯功能完全正常，
 * 但「离线可用」和「安装为应用」需要 HTTPS。详见 docs/DEPLOY.md。
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const rootDir = resolve(process.argv[2] ?? ".");
const port = Number(process.env.PORT ?? 5180);
// 默认绑 0.0.0.0，这样同一 Wi-Fi 下的手机也能访问
const host = process.env.HOST ?? "0.0.0.0";

/** 把 URL 路径安全地映射到磁盘路径，拒绝任何越界访问 */
function resolveTarget(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = normalize(decoded).replace(/^([/\\])+/, "");
  const target = resolve(join(rootDir, normalized));
  if (target !== rootDir && !target.startsWith(rootDir + sep)) return null;
  return target;
}

async function statOrNull(path) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

/** 本机所有可供手机访问的 IPv4 地址 */
function lanAddresses() {
  const found = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) found.push({ name, address: entry.address });
    }
  }
  return found;
}

const server = createServer(async (request, response) => {
  try {
    const urlPath = (request.url ?? "/").split("?")[0];
    let target = resolveTarget(request.url ?? "/");
    if (!target) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    let info = await statOrNull(target);

    if (info?.isDirectory()) {
      // 目录路径必须以 / 结尾，否则相对资源会算错
      if (!urlPath.endsWith("/")) {
        response.writeHead(301, { Location: `${urlPath}/` }).end();
        return;
      }

      // 仓库布局下，根目录不是站点根 —— 必须真正跳到 /apps/web/，
      // 否则浏览器仍以 / 为基准，styles/app.css 之类的相对路径会全部 404。
      const webEntry = join(target, "apps", "web");
      if ((await statOrNull(webEntry))?.isDirectory()) {
        response.writeHead(302, { Location: "/apps/web/" }).end();
        return;
      }

      // 站点根（例如 dist/）：直接服务同目录下的 index.html
      target = join(target, "index.html");
      info = await statOrNull(target);
    }

    if (!info?.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 Not Found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": "no-cache",
    });
    createReadStream(target).pipe(response);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end(`500 ${error.message}`);
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${port} 已被占用。换一个：PORT=5199 node scripts/serve.mjs`);
  } else {
    console.error("服务器启动失败：", error.message);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  const lines = [];
  lines.push("");
  lines.push("  熄灯早睡 · 本地服务器已启动");
  lines.push(`  服务目录：${rootDir}`);
  lines.push("");
  lines.push("  电脑上打开：");
  lines.push(`    http://127.0.0.1:${port}/`);
  lines.push("");

  const lans = lanAddresses();
  if (host !== "127.0.0.1" && lans.length) {
    lines.push("  手机上打开（需与电脑连同一个 Wi-Fi）：");
    for (const { name, address } of lans) {
      lines.push(`    http://${address}:${port}/        （${name}）`);
    }
    lines.push("");
    lines.push("  提示：手机上首次访问需要先在主页点「立即体验熄灯模式」才能看到熄灯界面。");
    lines.push("  提示：局域网 http 下「离线可用」与「安装为应用」不可用，需要 HTTPS。");
  } else if (host === "127.0.0.1") {
    lines.push("  当前只监听 127.0.0.1，手机无法访问。去掉 HOST 或设为 0.0.0.0 即可。");
  } else {
    lines.push("  未检测到局域网 IPv4 地址，手机可能无法访问。");
  }

  lines.push("");
  lines.push("  按 Ctrl+C 停止");
  lines.push("");
  console.log(lines.join("\n"));
});
