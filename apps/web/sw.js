/**
 * 熄灯早睡 · Service Worker
 *
 * 目标：熄灯时段内**必须能离线打开**。否则一旦断网，用户就会被挡在熄灯界面之外，
 * 反而变成了"绕过"的捷径。因此这里采用 cache-first 策略，把应用外壳全部预缓存。
 *
 * 版本号变更时旧缓存会被清理，避免用户卡在旧版本资源上。
 */

// 这个值在**构建时会被 scripts/build.mjs 覆盖**成"预缓存内容哈希"。
// 源码里留一个占位值即可，不要手工维护它 —— 靠人记得改版本号是不可靠的：
// 只要改了 app.js 而没动 sw.js，浏览器就会一直用缓存里的旧 app.js，
// 用户看到的是"修复没生效"，而其实是缓存。这一条已经踩过一次。
const CACHE_VERSION = "xideng-dev";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./styles/app.css",
  "./src/app.js",
  "./src/core.js",
  "./src/lib/dom.js",
  "./src/lib/lamp.js",
  "./src/lib/share-card.js",
  "./src/views/blackout.js",
  "./src/views/controls.js",
  "./src/views/home.js",
  "./src/views/onboarding.js",
  "./src/views/profile.js",
  "./src/views/sheets.js",
  "./core/src/index.js",
  "./core/src/constants.js",
  "./core/src/time.js",
  "./core/src/holidays.js",
  "./core/src/schedule.js",
  "./core/src/scene.js",
  "./core/src/copy.js",
  "./core/src/quota.js",
  "./core/src/whitelist.js",
  "./core/src/storage.js",
  "./core/src/settings.js",
  "./core/src/password.js",
  "./core/src/sleep.js",
  "./core/src/ai.js",
  "./core/src/audio.js",
  "./core/src/guard.js",
  "./core/src/engine.js",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // 单个资源 404 不应让整次预缓存失败
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // 绝不缓存第三方请求（用户自配的 AI 接口等），避免把 API Key 相关响应写入磁盘
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match("./index.html"));
    }),
  );
});
