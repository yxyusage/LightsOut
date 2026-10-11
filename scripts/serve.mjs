#!/usr/bin/env node
/**
 * 零依赖静态服务器。
 *
 * 用途：本地预览。PWA 的 Service Worker 与"添加到主屏幕"都需要 http(s) 上下文，
 * 直接双击 index.html（file://）是拿不到这些能力的，所以开发时必须走这个服务器。
 *
 * 用法：
 *   node scripts/serve.mjs            # 服务仓库根目录，入口自动跳到 apps/web/
 *   node scripts/serve.mjs dist       # 服务构建产物
 *   PORT=5199 node scripts/serve.mjs
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
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
const host = process.env.HOST ?? "127.0.0.1";

/** 把 URL 路径安全地映射到磁盘路径，拒绝任何越界访问 */
function resolveTarget(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = normalize(decoded).replace(/^([/\\])+/, "");
  const target = resolve(join(rootDir, normalized));
  // 必须仍位于 rootDir 之内
  if (target !== rootDir && !target.startsWith(rootDir + sep)) return null;
  return target;
}

const server = createServer(async (request, response) => {
  try {
    let target = resolveTarget(request.url ?? "/");
    if (!target) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    let info = await stat(target).catch(() => null);

    // 根目录 → 仓库布局时跳到 apps/web/，构建产物则直接给 index.html
    if (info?.isDirectory()) {
      if (!request.url.endsWith("/")) {
        response.writeHead(301, { Location: `${request.url}/` }).end();
        return;
      }
      const webEntry = join(target, "apps", "web");
      const webInfo = await stat(webEntry).catch(() => null);
      target = webInfo?.isDirectory() ? join(webEntry, "index.html") : join(target, "index.html");
      info = await stat(target).catch(() => null);
    }

    if (!info?.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 Not Found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": "no-cache",
      // Service Worker 需要正确的 scope，跨源隔离头对 Wake Lock 没有影响，这里保持最简
    });
    createReadStream(target).pipe(response);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end(`500 ${error.message}`);
  }
});

server.listen(port, host, () => {
  const base = `http://${host}:${port}`;
  console.log(`熄灯早睡 · 静态服务器已启动`);
  console.log(`  根目录: ${rootDir}`);
  console.log(`  访问:   ${base}/`);
});
