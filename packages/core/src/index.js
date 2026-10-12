/**
 * 熄灯早睡 · 核心包入口
 *
 * 这是一个**平台无关**的纯 ESM 包：不引用 DOM、不引用 Node API、不依赖任何第三方库。
 * Web/PWA 端、.NET 桌面端的 WebView、Android 端的 WebView 共用同一份熄灯判定逻辑，
 * 从而保证"什么时间算熄灯、额度怎么算、文案怎么挑"在所有端上完全一致。
 */

export * from "./constants.js";
export * from "./time.js";
export * from "./holidays.js";
export * from "./schedule.js";
export * from "./scene.js";
export * from "./copy.js";
export * from "./quota.js";
export * from "./whitelist.js";
export * from "./sleep.js";
export * from "./storage.js";
export * from "./settings.js";
export * from "./password.js";
export * from "./ai.js";
export * from "./audio.js";
export * from "./guard.js";
export * from "./engine.js";
