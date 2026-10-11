/**
 * 熄灯早睡 · Web/PWA 端入口
 *
 * 职责分工刻意划清：
 *  · core（packages/core）负责"什么时间算熄灯、额度怎么扣、文案怎么挑"——纯逻辑，可测试；
 *  · 本文件负责"把这些结论落到屏幕上"——DOM、动画、权限、持久化。
 *
 * 因此 Android 版与桌面版可以复用同一个 core，只替换这一层。
 */

import * as core from "./core.js";
import { setHidden, toast } from "./lib/dom.js";
import { createLamp } from "./lib/lamp.js";
import { createBlackoutView, createWarningView } from "./views/blackout.js";
import { createHomeView } from "./views/home.js";
import { createOnboardingView } from "./views/onboarding.js";
import { createProfileView } from "./views/profile.js";
import { createSheets } from "./views/sheets.js";

const DEMO_DURATION_MS = 2 * 60_000;
const TICK_MS = 250;
const DEMO_KEY = "xideng.demo.until";

/* ═════════════ 1. 持久化与引擎装配 ═════════════ */

/** sessionStorage 在无痕模式下可能可以直接抛异常，所以必须探测后再用 */
function createSessionStore() {
  try {
    const probe = "__xideng_probe__";
    window.sessionStorage.setItem(probe, "1");
    window.sessionStorage.removeItem(probe);
    return window.sessionStorage;
  } catch {
    return core.createMemoryStorage();
  }
}

const sessionStore = createSessionStore();
const settingsStore = core.createSettingsStore();
const quotaStore = core.createQuotaStore({ storage: settingsStore.storage });
quotaStore.setTotal(settingsStore.value.emergency.quotaTotal);

/**
 * 白名单计费周期取"当前熄灯时段的开始日"而非日历日。
 * 这样 23:00 → 次日 07:00 的一次熄灯共用一个额度池，跨过午夜不会白送一份新额度。
 * 理由与取舍见 packages/core/src/whitelist.js 顶部注释与 docs/DECISIONS.md。
 */
const budget = core.createWhitelistBudget({
  storage: settingsStore.storage,
  getTotalMinutes: () => settingsStore.value.whitelist.totalMinutes,
  getPeriodKey: (at) => {
    const window = core.activeWindowAt(settingsStore.value.plan, at);
    return window ? `window:${window.startKey}` : `day:${core.dateKey(at)}`;
  },
});

const engine = core.createEngine({ settingsStore, quotaStore });
const audio = core.createAudioEngine();
const ai = core.createAIClient({
  getConfig: () => settingsStore.value.ai,
  cache: sessionStore,
});

// 设置变化时同步额度上限（用户可能在个人中心调整）
settingsStore.subscribe((settings) => quotaStore.setTotal(settings.emergency.quotaTotal));

/* ═════════════ 2. UI 状态 ═════════════ */

function readDemoUntil() {
  const value = Number(sessionStore.getItem(DEMO_KEY) || 0);
  return Number.isFinite(value) && value > Date.now() ? value : 0;
}

const ui = {
  screen: settingsStore.value.onboarded ? "home" : "onboarding",
  /** null | "warning" | "blackout" */
  overlay: null,
  phaseToken: 0,
  copyTimer: null,
  aiRequested: false,
  demoUntil: readDemoUntil(),
  /** 检测到改时间后冻结到的时刻——在此之前一律视为熄灯中 */
  freezeUntil: null,
  lastActiveWindowEnd: null,
  whitelistSession: null,
  wakeLockSentinel: null,
  disposers: [],
};

function isDemo() {
  return Date.now() < ui.demoUntil;
}

/**
 * 实际生效的相位。
 * 演示模式与"改时间冻结"都只能**加强**熄灯状态，永远不会削弱它 —— 这一点很关键：
 * 任何绕过手段都不能让 phase 从 active 变成别的值。
 */
function effectivePhase(snapshot) {
  if (isDemo()) return core.PHASE.ACTIVE;

  // ⚠️ 首次引导尚未完成时，绝不接管屏幕。
  //
  // 默认计划是「已开启 + 23:00–07:00」，也就是说**新用户如果在深夜第一次打开应用，
  // 会被直接锁进黑屏**：看不到引导页、没机会设置自己的时段，
  // 而唯一的出口是「连点屏幕 5 次」这种刻意隐藏的入口。
  // 首次打开就被关起来是很糟糕的第一印象，所以这里显式放行，
  // 等用户走完引导（onboarded = true）后再按计划接管。
  if (!settingsStore.value.onboarded) return core.PHASE.OFF;

  if (ui.freezeUntil) {
    if (Date.now() < ui.freezeUntil.getTime()) return core.PHASE.ACTIVE;
    ui.freezeUntil = null;
  }
  return snapshot.phase;
}

const uiApi = {
  isDemo,
  demoRemainingMs: () => Math.max(0, ui.demoUntil - Date.now()),
  effectivePhase,
  get screen() {
    return ui.screen;
  },
};

/* ═════════════ 3. 装配视图（actions 先占位，稍后填充）═════════════ */

const ctx = {
  core,
  settingsStore,
  quotaStore,
  budget,
  engine,
  audio,
  ai,
  ui: uiApi,
  actions: {},
  toast,
};

const homeView = createHomeView(ctx);
const profileView = createProfileView(ctx);
const onboardingView = createOnboardingView(ctx);
const blackoutView = createBlackoutView(ctx);
const warningView = createWarningView(ctx);
const sheetsView = createSheets(ctx);
const lamp = createLamp({ element: document.getElementById("lamp") });

/* ═════════════ 4. 具体动作 ═════════════ */

function remainingToWindowEnd() {
  const snapshot = engine.snapshot();
  if (effectivePhase(snapshot) === core.PHASE.ACTIVE && snapshot.window) {
    return Math.max(0, snapshot.window.end.getTime() - snapshot.at.getTime());
  }
  return 8 * 3_600_000;
}

function endWhitelistSession() {
  const session = ui.whitelistSession;
  if (!session) return;
  ui.whitelistSession = null;
  const elapsedMs = Date.now() - session.startedAt;
  if (!session.app.countsAgainstQuota || elapsedMs < 1000) return;
  const result = budget.charge(elapsedMs, new Date());
  if (result.exhausted) {
    toast("白名单时长已用尽，已返回熄灯界面", { type: "error", duration: 4000 });
  }
}

const actions = {
  goTo(screen) {
    if (ui.screen === screen) return;
    ui.screen = screen;
    if (screen === "onboarding") onboardingView.show();
    applyScreen();
    render();
  },

  openSheet(id) {
    sheetsView.open(id);
    sheetsView.update(engine.snapshot());
  },

  closeSheet(id) {
    sheetsView.close(id);
  },

  /* ── 睡眠计划 ── */

  setPlanEnabled(enabled) {
    settingsStore.update({ plan: { enabled } });
    if (!enabled) {
      ui.freezeUntil = null;
      ui.lastActiveWindowEnd = null;
    }
    render();
  },

  setWindow(dayType, patch) {
    const current = settingsStore.value.plan.windows[dayType];
    const next = { ...current, ...patch };
    // 先落盘，再提示问题：用户需要看到自己刚输入的值，而不是被弹回旧值
    settingsStore.update({ plan: { windows: { [dayType]: next } } });
    const problems = core.validateWindow(next);
    if (problems.length) toast(problems[0], { type: "error", duration: 3200 });
    render();
  },

  setWarnMinutes(minutes) {
    settingsStore.update({ plan: { warnMinutes: minutes } });
    render();
  },

  /* ── 演示模式：让人不必等到 23:00 就能看效果 ── */

  startDemo() {
    ui.demoUntil = Date.now() + DEMO_DURATION_MS;
    sessionStore.setItem(DEMO_KEY, String(ui.demoUntil));
    render();
  },

  exitDemo() {
    ui.demoUntil = 0;
    sessionStore.setItem(DEMO_KEY, "0");
    render();
  },

  /* ── 助眠音频 ── */

  setAudioPreset(presetId) {
    settingsStore.update({ audio: { preset: presetId } });
    if (audio.isPlaying) {
      const settings = settingsStore.value.audio;
      const durationMs = settings.durationMinutes > 0 ? settings.durationMinutes * 60_000 : remainingToWindowEnd();
      audio.play(presetId, { durationMs });
    }
    render();
  },

  setAudioDuration(minutes) {
    settingsStore.update({ audio: { durationMinutes: minutes } });
    render();
  },

  setAudioVolume(volume) {
    settingsStore.update({ audio: { volume } });
    audio.setVolume(volume);
    render();
  },

  async toggleAudio() {
    if (audio.isPlaying) {
      audio.stop();
      render();
      return;
    }
    const settings = settingsStore.value.audio;
    const durationMs = settings.durationMinutes > 0 ? settings.durationMinutes * 60_000 : remainingToWindowEnd();
    const result = await audio.play(settings.preset, { durationMs });
    if (!result.ok) {
      const reasons = {
        unsupported: "当前浏览器不支持 Web Audio，无法合成白噪音",
        "unknown-preset": "音色不存在",
      };
      toast(reasons[result.reason] ?? "播放失败", { type: "error" });
    }
    render();
  },

  /* ── 白名单 ── */

  addWhitelistApp({ name, url }) {
    const apps = settingsStore.value.whitelist.apps;
    if (apps.some((app) => app.name === name)) return { ok: false, reason: "已经有同名的应用了" };
    if (apps.length >= 30) return { ok: false, reason: "最多添加 30 个应用" };
    const app = {
      id: `app-${Date.now().toString(36)}`,
      name,
      system: false,
      removable: true,
      countsAgainstQuota: true,
      uri: "",
      url: url ?? "",
      description: "",
    };
    settingsStore.update({ whitelist: { apps: [...apps, app] } });
    render();
    return { ok: true };
  },

  removeWhitelistApp(id) {
    const apps = settingsStore.value.whitelist.apps.filter((app) => app.id !== id || !app.removable);
    settingsStore.update({ whitelist: { apps } });
    render();
  },

  setWhitelistTotal(minutes) {
    settingsStore.update({ whitelist: { totalMinutes: minutes } });
    render();
  },

  openWhitelistApp(app) {
    if (app.countsAgainstQuota && budget.isExhausted(new Date())) {
      toast("今日白名单时长已用尽", { type: "error" });
      return;
    }
    const target = app.uri || app.url;
    if (!target) {
      toast("这个应用还没有配置打开地址，请先编辑或移除", { type: "error" });
      return;
    }
    // 计时从"离开本页"开始，回来后结算（见 visibilitychange 处理）
    ui.whitelistSession = { app, startedAt: Date.now() };
    sheetsView.closeAll();
    if (app.uri) window.location.href = app.uri;
    else window.open(target, "_blank", "noopener,noreferrer");
  },

  /* ── AI ── */

  saveAISettings(patch) {
    settingsStore.update({ ai: patch });
    render();
  },

  async testAIConnection() {
    const config = settingsStore.value.ai;
    if (!config.apiKey) return { ok: false, message: "请先填写 API Key" };
    ai.clearCache();
    const result = await ai.generate(core.detectScene(new Date()));
    if (result.ok) return { ok: true, message: `连接成功，返回文案：「${result.text}」` };
    const messages = {
      "http-401": "API Key 无效（401）",
      "http-403": "无权访问该模型（403）",
      "http-404": "接口地址或模型名称不存在（404）",
      "http-429": "请求过于频繁或额度不足（429）",
      timeout: "请求超时",
      network: "网络不可达，或接口地址填写有误（也可能是浏览器跨域限制）",
      "empty-response": "接口返回内容为空",
      disabled: "AI 功能未启用",
      "no-api-key": "未填写 API Key",
    };
    return { ok: false, message: messages[result.reason] ?? `调用失败：${result.reason}` };
  },

  /* ── 密码与紧急解除 ── */

  async savePassword(password) {
    const hash = await core.hashPassword(password);
    settingsStore.update({ emergency: { passwordHash: hash } });
    toast("密码已更新");
  },

  async finishOnboarding(password) {
    const hash = await core.hashPassword(password);
    settingsStore.update({ emergency: { passwordHash: hash }, onboarded: true });
    ui.screen = "home";
    applyScreen();
    render();
    if (!window.matchMedia("(display-mode: standalone)").matches) {
      toast("提示：把本页添加到主屏幕，可获得全屏独立运行的熄灯体验", { duration: 5200 });
    }
  },

  openEmergency() {
    sheetsView.open("emergency");
    sheetsView.update(engine.snapshot());
  },

  async submitEmergency(password) {
    const result = await engine.emergencyUnlock(password);
    if (result.ok) {
      toast(`已解除，本周还剩 ${result.remaining} 次`);
      render();
      return { ok: true };
    }
    const messages = {
      "no-password": "尚未设置紧急解除密码，请先到个人中心设置",
      "not-active": "当前不在熄灯时段内",
      "bad-password": "密码不正确",
      "quota-exhausted": "本周解除额度已用完，只能等熄灯时段结束",
    };
    return { ok: false, message: messages[result.reason] ?? "解除失败" };
  },

  clearAllData() {
    if (!window.confirm("将清除本机保存的全部设置、密码与用量记录，且无法恢复。确定继续？")) return;
    settingsStore.reset();
    quotaStore.reset(new Date());
    budget.reset(new Date());
    ai.clearCache();
    try {
      sessionStore.clear?.();
    } catch {
      /* 忽略 */
    }
    ui.demoUntil = 0;
    ui.freezeUntil = null;
    ui.screen = "onboarding";
    onboardingView.show();
    applyScreen();
    render();
    toast("已清除全部本地数据");
  },
};

// 把实现填进视图创建时就已持有的那个对象（视图按引用读取，因此顺序无关）
Object.assign(ctx.actions, actions);

/* ═════════════ 5. 屏幕与相位切换 ═════════════ */

const screens = {
  home: document.getElementById("screen-home"),
  profile: document.getElementById("screen-profile"),
  onboarding: document.getElementById("screen-onboarding"),
};

function applyScreen() {
  for (const [name, node] of Object.entries(screens)) setHidden(node, name !== ui.screen);
}

function scheduleCopyRotation() {
  stopCopyRotation();
  const intervalMs = engine.snapshot().copyIntervalMs || core.COPY_ROTATE_MS;
  ui.copyTimer = setTimeout(() => {
    if (ui.overlay !== "blackout") return;
    // AI 生成的场景化文案只作为"开场第一句"，展示一轮后交还给本地文案库，
    // 这样既保留"它知道今天是什么日子"的惊喜，也不会因为接口波动而断流。
    if (engine.aiText) engine.setAIText(null);
    else engine.rotateCopy();
    render();
    scheduleCopyRotation();
  }, intervalMs);
}

function stopCopyRotation() {
  clearTimeout(ui.copyTimer);
  ui.copyTimer = null;
}

async function requestAICopy(snapshot) {
  if (ui.aiRequested || !ai.available) return;
  ui.aiRequested = true;
  const result = await ai.generate(snapshot.scene);
  if (result.ok && ui.overlay === "blackout") {
    engine.setAIText(result.text);
    render();
  }
}

/**
 * 应用相位。这是"到点自动接管"的唯一入口，
 * 视图的显隐完全由它决定，不接受任何用户操作直接修改。
 */
async function applyPhase(snapshot) {
  const phase = effectivePhase(snapshot);
  let next = null;
  if (phase === core.PHASE.ACTIVE) next = "blackout";
  else if (phase === core.PHASE.WARNING) next = "warning";

  if (next === ui.overlay) return;
  const previous = ui.overlay;
  ui.overlay = next;
  // 动画是异步的，期间相位可能又变了；用令牌作废过期的这次切换
  const token = (ui.phaseToken += 1);

  if (next === "blackout") {
    document.body.classList.add("is-locked");
    if (previous !== "blackout") {
      await lamp.playEnter();
      if (ui.phaseToken !== token) return;
    }
    blackoutView.reset();
    engine.resetCopy();
    ui.aiRequested = false;
    setHidden(blackoutView.root, false);
    setHidden(warningView.root, true);
    installGuards();
    scheduleCopyRotation();
    requestAICopy(snapshot);
    if (isDemo()) toast("演示模式已开启，2 分钟后自动结束");
    return;
  }

  if (next === "warning") {
    document.body.classList.add("is-locked");
    setHidden(warningView.root, false);
    setHidden(blackoutView.root, true);
    stopCopyRotation();
    return;
  }

  // 回到普通界面
  document.body.classList.remove("is-locked");
  if (previous === "blackout") {
    await lamp.playExit();
    if (ui.phaseToken !== token) return;
  }
  setHidden(blackoutView.root, true);
  setHidden(warningView.root, true);
  stopCopyRotation();
  uninstallGuards();
  endWhitelistSession();
  if (audio.isPlaying) audio.stop();
}

/* ═════════════ 6. 防绕过守卫（PRD 三）═════════════ */

function beforeUnloadGuard(event) {
  event.preventDefault();
  event.returnValue = "";
}

async function installGuards() {
  // 演示模式下不安装"甩不掉"的守卫，避免把只想看看效果的人困在界面里
  const demo = isDemo();

  if (!demo) {
    const trap = core.installHistoryTrap(window.history, () => toast("熄灯模式无法通过返回键退出"));
    ui.disposers.push(() => trap.dispose());
    window.addEventListener("beforeunload", beforeUnloadGuard);
    ui.disposers.push(() => window.removeEventListener("beforeunload", beforeUnloadGuard));
  }

  if (settingsStore.value.guard.wakeLock && !ui.wakeLockSentinel) {
    ui.wakeLockSentinel = await core.requestWakeLock(navigator);
  }
}

function uninstallGuards() {
  for (const dispose of ui.disposers.splice(0)) {
    try {
      dispose();
    } catch {
      /* 单个清理失败不影响其它 */
    }
  }
  try {
    ui.wakeLockSentinel?.release?.();
  } catch {
    /* 唤醒锁可能已被系统回收 */
  }
  ui.wakeLockSentinel = null;
}

/**
 * 系统时间篡改检测（PRD 三）。
 * 一旦在熄灯期间检出跳变，就把熄灯状态冻结到"原本的时段结束时刻"，
 * 这样无论用户把时间往前拨还是往后拨，都甩不掉熄灯界面。
 */
const clockGuard = core.createClockGuard({
  onJump: (event) => {
    if (!settingsStore.value.guard.detectClockTamper) return;
    const snapshot = engine.snapshot();
    if (effectivePhase(snapshot) !== core.PHASE.ACTIVE) return;
    const frozenEnd = ui.lastActiveWindowEnd ?? snapshot.window?.end ?? null;
    if (!frozenEnd) return;
    ui.freezeUntil = frozenEnd;
    toast(`检测到系统时间被修改（${event.direction === "forward" ? "向前" : "向后"}），已恢复熄灯模式`, {
      type: "error",
      duration: 4200,
    });
    render();
  },
});

/* ═════════════ 7. 渲染与主循环 ═════════════ */

function render() {
  const snapshot = engine.snapshot();

  if (ui.screen === "onboarding") onboardingView.update(snapshot);
  else if (ui.screen === "profile") profileView.update(snapshot, uiApi);
  else homeView.update(snapshot, uiApi);

  if (ui.overlay === "blackout") blackoutView.update(snapshot, uiApi);
  else if (ui.overlay === "warning") warningView.update(snapshot);

  if (sheetsView.anyOpen) sheetsView.update(snapshot);

  // 熄灯结束后自动停止音频（PRD 2.3「播放结束后自动停止」）
  if (audio.isPlaying && ui.overlay !== "blackout") audio.stop();
}

function tick() {
  const snapshot = engine.snapshot();
  const phase = effectivePhase(snapshot);

  if (phase === core.PHASE.ACTIVE && snapshot.window) {
    ui.lastActiveWindowEnd = snapshot.window.end;
  } else if (!isDemo() && !ui.freezeUntil) {
    ui.lastActiveWindowEnd = null;
  }

  clockGuard.sample();
  render();
  // applyPhase 是异步的（要等入场动画），这里不能 await —— 否则主循环会被动画阻塞。
  // 但必须兜住异常，否则一次失败就会变成 unhandled rejection 并让后续帧静默失效。
  applyPhase(snapshot).catch((error) => {
    console.error("[xideng] 相位切换失败", error);
  });
}

/* ═════════════ 8. 生命周期 ═════════════ */

// 切走再回来立刻重新接管（PRD 2.2.1 的 Web 等效实现）
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  endWhitelistSession();
  if (settingsStore.value.guard.reassertOnVisible) tick();
});

// 熄灯界面内禁止右键菜单，减少"另存/检查"这类脱身路径
document.addEventListener("contextmenu", (event) => {
  if (ui.overlay === "blackout" && !event.target.closest("input, textarea")) event.preventDefault();
});

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const { protocol, hostname } = window.location;
  const secure = protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1";
  if (!secure) {
    // Service Worker 只在安全上下文可用；file:// 直接打开时跳过即可
    return;
  }
  try {
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  } catch (error) {
    console.info("[xideng] Service Worker 注册失败，离线能力不可用：", error);
  }
}

function boot() {
  applyScreen();
  if (ui.screen === "onboarding") onboardingView.show();
  // 立即执行一次，避免"打开页面后要等 250ms 才进入熄灯界面"造成的时间漏洞
  tick();
  setInterval(tick, TICK_MS);
  registerServiceWorker();
}

boot();

// 便于在浏览器控制台排查问题；生产使用中不依赖它
window.__xideng = { core, settingsStore, quotaStore, budget, engine, ai, audio, ui, actions };
