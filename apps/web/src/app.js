/**
 * 鐔勭伅鏃╃潯 路 Web/PWA 绔叆鍙? *
 * 鑱岃矗鍒嗗伐鍒绘剰鍒掓竻锛? *  路 core锛坧ackages/core锛夎礋璐?浠€涔堟椂闂寸畻鐔勭伅銆侀搴︽€庝箞鎵ｃ€佹枃妗堟€庝箞鎸?鈥斺€旂函閫昏緫锛屽彲娴嬭瘯锛? *  路 鏈枃浠惰礋璐?鎶婅繖浜涚粨璁鸿惤鍒板睆骞曚笂"鈥斺€擠OM銆佸姩鐢汇€佹潈闄愩€佹寔涔呭寲銆? *
 * 鍥犳 Android 鐗堜笌妗岄潰鐗堝彲浠ュ鐢ㄥ悓涓€涓?core锛屽彧鏇挎崲杩欎竴灞傘€? */

import * as core from "./core.js";
import { setHidden, toast } from "./lib/dom.js";
import { createLamp } from "./lib/lamp.js";

/**
 * 搴旂敤鐗堟湰鍙枫€? *
 * 鈿狅笍 蹇呴』涓?package.json 鐨?version 涓€鑷?鈥斺€?scripts/check.mjs 浼氭牎楠岋紝
 * 涓嶄竴鑷寸洿鎺ヨ妫€鏌ュけ璐ャ€侫ndroid 绔凡缁忓洜涓?鐗堟湰鍙峰啓姝?鍚冭繃涓€娆′簭锛? * 鐢ㄦ埛瑁呬簡鏂扮増鍗寸湅鍒版棫鐗堟湰鍙凤紝浜庢槸鍚堢悊鍦拌涓轰慨澶嶆病鐢熸晥銆? */
const APP_VERSION = "1.1.1";
import { createBlackoutView, createWarningView } from "./views/blackout.js";
import { createHomeView } from "./views/home.js";
import { createOnboardingView } from "./views/onboarding.js";
import { createProfileView } from "./views/profile.js";
import { createSheets } from "./views/sheets.js";

// 婕旂ず鐢?30 绉掞細鐭埌涓嶇敤绛夛紝闀垮埌鑳界湅娓呭懠鍚稿厜鏅曘€佹枃妗堣疆鎾笌"浠婂杩涘害"銆?// 鍘熸潵 2 鍒嗛挓瀵硅瘎瀹℃槸绾补鐨勭瓑寰?鈥斺€?浠栧彧鏄兂鐪嬩竴鐪兼晥鏋溿€?const DEMO_DURATION_MS = 30_000;
const TICK_MS = 250;
const DEMO_KEY = "xideng.demo.until";

/* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?1. 鎸佷箙鍖栦笌寮曟搸瑁呴厤 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?*/

/** sessionStorage 鍦ㄦ棤鐥曟ā寮忎笅鍙兘鍙互鐩存帴鎶涘紓甯革紝鎵€浠ュ繀椤绘帰娴嬪悗鍐嶇敤 */
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
 * 鐧藉悕鍗曡璐瑰懆鏈熷彇"褰撳墠鐔勭伅鏃舵鐨勫紑濮嬫棩"鑰岄潪鏃ュ巻鏃ャ€? * 杩欐牱 23:00 鈫?娆℃棩 07:00 鐨勪竴娆＄唲鐏叡鐢ㄤ竴涓搴︽睜锛岃法杩囧崍澶滀笉浼氱櫧閫佷竴浠芥柊棰濆害銆? * 鐞嗙敱涓庡彇鑸嶈 packages/core/src/whitelist.js 椤堕儴娉ㄩ噴涓?docs/DECISIONS.md銆? */
const budget = core.createWhitelistBudget({
  storage: settingsStore.storage,
  getTotalMinutes: () => settingsStore.value.whitelist.totalMinutes,
  getPeriodKey: (at) => {
    const window = core.activeWindowAt(settingsStore.value.plan, at);
    return window ? `window:${window.startKey}` : `day:${core.dateKey(at)}`;
  },
});

/** 姣忔棩鐫＄湢璁板綍锛氭湰鍛ㄥ潥鎸佸洖椤剧殑鏁版嵁婧?*/
const sleepRecords = core.createSleepRecords({ storage: settingsStore.storage });

const engine = core.createEngine({
  settingsStore,
  quotaStore,
  // 鐧藉悕鍗曞墿浣欐椂闀夸互鐪熷疄棰勭畻涓哄噯锛堣法鍗堝鏃舵鍏辩敤涓€涓搴︽睜锛岃 whitelist.js 娉ㄩ噴锛?  getWhitelistRemainingMs: () => budget.remainingMs(new Date()),
});
const audio = core.createAudioEngine();
const ai = core.createAIClient({
  getConfig: () => settingsStore.value.ai,
  cache: sessionStore,
});

// 璁剧疆鍙樺寲鏃跺悓姝ラ搴︿笂闄愶紙鐢ㄦ埛鍙兘鍦ㄤ釜浜轰腑蹇冭皟鏁达級
settingsStore.subscribe((settings) => quotaStore.setTotal(settings.emergency.quotaTotal));

/* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?2. UI 鐘舵€?鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?*/

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
  /** 妫€娴嬪埌鏀规椂闂村悗鍐荤粨鍒扮殑鏃跺埢鈥斺€斿湪姝や箣鍓嶄竴寰嬭涓虹唲鐏腑 */
  freezeUntil: null,
  lastActiveWindowEnd: null,
  /** 鏈懆鍥為【锛氭渶杩戜竴娆″凡璁板綍鐨勭唲鐏椂娈甸敭锛堝悓涓€鏃舵鍙涓€娆?杩涘叆"锛?*/
  lastRecordedWindowKey: null,
  /** 宸茬粡瀹屾垚杩囨媺缁充华寮忕殑鏃舵閿紙姣忎釜鐔勭伅鏃舵鍙姹傛媺涓€娆★級 */
  lastPulledWindowKey: null,
  whitelistSession: null,
  wakeLockSentinel: null,
  disposers: [],
};

function isDemo() {
  return Date.now() < ui.demoUntil;
}

/**
 * 瀹為檯鐢熸晥鐨勭浉浣嶃€? * 婕旂ず妯″紡涓?鏀规椂闂村喕缁?閮藉彧鑳?*鍔犲己**鐔勭伅鐘舵€侊紝姘歌繙涓嶄細鍓婂急瀹?鈥斺€?杩欎竴鐐瑰緢鍏抽敭锛? * 浠讳綍缁曡繃鎵嬫閮戒笉鑳借 phase 浠?active 鍙樻垚鍒殑鍊笺€? */
function effectivePhase(snapshot) {
  if (isDemo()) return core.PHASE.ACTIVE;

  // 鈿狅笍 棣栨寮曞灏氭湭瀹屾垚鏃讹紝缁濅笉鎺ョ灞忓箷銆?  //
  // 榛樿璁″垝鏄€屽凡寮€鍚?+ 23:00鈥?7:00銆嶏紝涔熷氨鏄**鏂扮敤鎴峰鏋滃湪娣卞绗竴娆℃墦寮€搴旂敤锛?  // 浼氳鐩存帴閿佽繘榛戝睆**锛氱湅涓嶅埌寮曞椤点€佹病鏈轰細璁剧疆鑷繁鐨勬椂娈碉紝
  // 鑰屽敮涓€鐨勫嚭鍙ｆ槸銆岃繛鐐瑰睆骞?5 娆°€嶈繖绉嶅埢鎰忛殣钘忕殑鍏ュ彛銆?  // 棣栨鎵撳紑灏辫鍏宠捣鏉ユ槸寰堢碂绯曠殑绗竴鍗拌薄锛屾墍浠ヨ繖閲屾樉寮忔斁琛岋紝
  // 绛夌敤鎴疯蛋瀹屽紩瀵硷紙onboarded = true锛夊悗鍐嶆寜璁″垝鎺ョ銆?  if (!settingsStore.value.onboarded) return core.PHASE.OFF;

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

/* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?3. 瑁呴厤瑙嗗浘锛坅ctions 鍏堝崰浣嶏紝绋嶅悗濉厖锛夆晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲 */

const ctx = {
  core,
  settingsStore,
  quotaStore,
  budget,
  sleepRecords,
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
const lamp = createLamp({
  element: document.getElementById("lamp"),
  promptElement: document.getElementById("lamp-prompt"),
});

/* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?4. 鍏蜂綋鍔ㄤ綔 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?*/

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
    toast("鐧藉悕鍗曟椂闀垮凡鐢ㄥ敖锛屽凡杩斿洖鐔勭伅鐣岄潰", { type: "error", duration: 4000 });
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

  /* 鈹€鈹€ 鐫＄湢璁″垝 鈹€鈹€ */

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
    // 鍏堣惤鐩橈紝鍐嶆彁绀洪棶棰橈細鐢ㄦ埛闇€瑕佺湅鍒拌嚜宸卞垰杈撳叆鐨勫€硷紝鑰屼笉鏄寮瑰洖鏃у€?    settingsStore.update({ plan: { windows: { [dayType]: next } } });
    const problems = core.validateWindow(next);
    if (problems.length) toast(problems[0], { type: "error", duration: 3200 });
    render();
  },

  setWarnMinutes(minutes) {
    settingsStore.update({ plan: { warnMinutes: minutes } });
    render();
  },

  setSundayAsWeekday(enabled) {
    settingsStore.update({ plan: { sundayAsWeekday: enabled } });
    render();
  },

  /* 鈹€鈹€ 婕旂ず妯″紡锛氳浜轰笉蹇呯瓑鍒?23:00 灏辫兘鐪嬫晥鏋?鈹€鈹€ */

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

  /* 鈹€鈹€ 鍔╃湢闊抽 鈹€鈹€ */

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
        unsupported: "褰撳墠娴忚鍣ㄤ笉鏀寔 Web Audio锛屾棤娉曞悎鎴愮櫧鍣煶",
        "unknown-preset": "闊宠壊涓嶅瓨鍦?,
      };
      toast(reasons[result.reason] ?? "鎾斁澶辫触", { type: "error" });
    }
    render();
  },

  /* 鈹€鈹€ 鐧藉悕鍗?鈹€鈹€ */

  addWhitelistApp({ name, url }) {
    const apps = settingsStore.value.whitelist.apps;
    if (apps.some((app) => app.name === name)) return { ok: false, reason: "宸茬粡鏈夊悓鍚嶇殑搴旂敤浜? };
    if (apps.length >= 30) return { ok: false, reason: "鏈€澶氭坊鍔?30 涓簲鐢? };
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
      toast("浠婃棩鐧藉悕鍗曟椂闀垮凡鐢ㄥ敖", { type: "error" });
      return;
    }
    const target = app.uri || app.url;
    if (!target) {
      toast("杩欎釜搴旂敤杩樻病鏈夐厤缃墦寮€鍦板潃锛岃鍏堢紪杈戞垨绉婚櫎", { type: "error" });
      return;
    }
    // 璁℃椂浠?绂诲紑鏈〉"寮€濮嬶紝鍥炴潵鍚庣粨绠楋紙瑙?visibilitychange 澶勭悊锛?    ui.whitelistSession = { app, startedAt: Date.now() };
    sheetsView.closeAll();
    if (app.uri) window.location.href = app.uri;
    else window.open(target, "_blank", "noopener,noreferrer");
  },

  /* 鈹€鈹€ AI 鈹€鈹€ */

  saveAISettings(patch) {
    settingsStore.update({ ai: patch });
    render();
  },

  async testAIConnection() {
    const config = settingsStore.value.ai;
    if (!config.apiKey) return { ok: false, message: "璇峰厛濉啓 API Key" };
    ai.clearCache();
    const result = await ai.generate(core.detectScene(new Date()));
    if (result.ok) return { ok: true, message: `杩炴帴鎴愬姛锛岃繑鍥炴枃妗堬細銆?{result.text}銆峘 };
    const messages = {
      "http-401": "API Key 鏃犳晥锛?01锛?,
      "http-403": "鏃犳潈璁块棶璇ユā鍨嬶紙403锛?,
      "http-404": "鎺ュ彛鍦板潃鎴栨ā鍨嬪悕绉颁笉瀛樺湪锛?04锛?,
      "http-429": "璇锋眰杩囦簬棰戠箒鎴栭搴︿笉瓒筹紙429锛?,
      timeout: "璇锋眰瓒呮椂",
      network: "缃戠粶涓嶅彲杈撅紝鎴栨帴鍙ｅ湴鍧€濉啓鏈夎锛堜篃鍙兘鏄祻瑙堝櫒璺ㄥ煙闄愬埗锛?,
      "empty-response": "鎺ュ彛杩斿洖鍐呭涓虹┖",
      disabled: "AI 鍔熻兘鏈惎鐢?,
      "no-api-key": "鏈～鍐?API Key",
    };
    return { ok: false, message: messages[result.reason] ?? `璋冪敤澶辫触锛?{result.reason}` };
  },

  /* 鈹€鈹€ 瀵嗙爜涓庣揣鎬ヨВ闄?鈹€鈹€ */

  async savePassword(password) {
    const hash = await core.hashPassword(password);
    settingsStore.update({ emergency: { passwordHash: hash } });
    toast("瀵嗙爜宸叉洿鏂?);
  },

  /** 蹇樿瀵嗙爜锛氱敵璇?24 灏忔椂鍚庢竻绌哄瘑鐮侊紙涓嶅奖鍝嶆湰鍛ㄩ搴︼級 */
  requestPasswordReset() {
    const info = engine.requestPasswordReset();
    const remainingHours = Math.ceil(info.remainingMs / 3_600_000);
    if (info.pending) {
      toast(`閲嶇疆鐢宠宸茬敓鏁堬細${remainingHours} 灏忔椂鍚庡瘑鐮佸皢琚竻绌猴紝灞婃椂鍙缃柊瀵嗙爜`, { duration: 5000 });
    }
    render();
    return info;
  },

  async finishOnboarding(password) {
    const hash = await core.hashPassword(password);
    settingsStore.update({ emergency: { passwordHash: hash }, onboarded: true });
    ui.screen = "home";
    applyScreen();
    render();
    if (!window.matchMedia("(display-mode: standalone)").matches) {
      toast("鎻愮ず锛氭妸鏈〉娣诲姞鍒颁富灞忓箷锛屽彲鑾峰緱鍏ㄥ睆鐙珛杩愯鐨勭唲鐏綋楠?, { duration: 5200 });
    }
  },

  openEmergency() {
    sheetsView.open("emergency");
    sheetsView.update(engine.snapshot());
  },

  async submitEmergency(password) {
    const result = await engine.emergencyUnlock(password);
    if (result.ok) {
      sleepRecords.record(core.dateKey(new Date()), { dismissed: true });
      toast(`宸茶В闄わ紝鏈懆杩樺墿 ${result.remaining} 娆);
      render();
      return { ok: true };
    }
    const messages = {
      "no-password": "灏氭湭璁剧疆绱ф€ヨВ闄ゅ瘑鐮侊紝璇峰厛鍒颁釜浜轰腑蹇冭缃?,
      "not-active": "褰撳墠涓嶅湪鐔勭伅鏃舵鍐?,
      "bad-password": "瀵嗙爜涓嶆纭?,
      "quota-exhausted": "鏈懆瑙ｉ櫎棰濆害宸茬敤瀹岋紝鍙兘绛夌唲鐏椂娈电粨鏉?,
    };
    return { ok: false, message: messages[result.reason] ?? "瑙ｉ櫎澶辫触" };
  },

  clearAllData() {
    if (!window.confirm("灏嗘竻闄ゆ湰鏈轰繚瀛樼殑鍏ㄩ儴璁剧疆銆佸瘑鐮佷笌鐢ㄩ噺璁板綍锛屼笖鏃犳硶鎭㈠銆傜‘瀹氱户缁紵")) return;
    settingsStore.reset();
    quotaStore.reset(new Date());
    budget.reset(new Date());
    sleepRecords.reset();
    ai.clearCache();
    try {
      sessionStore.clear?.();
    } catch {
      /* 蹇界暐 */
    }
    ui.demoUntil = 0;
    ui.freezeUntil = null;
    ui.screen = "onboarding";
    onboardingView.show();
    applyScreen();
    render();
    toast("宸叉竻闄ゅ叏閮ㄦ湰鍦版暟鎹?);
  },
};

// 鎶婂疄鐜板～杩涜鍥惧垱寤烘椂灏卞凡鎸佹湁鐨勯偅涓璞★紙瑙嗗浘鎸夊紩鐢ㄨ鍙栵紝鍥犳椤哄簭鏃犲叧锛?Object.assign(ctx.actions, actions);

/* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?5. 灞忓箷涓庣浉浣嶅垏鎹?鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?*/

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
    // AI 鐢熸垚鐨勫満鏅寲鏂囨鍙綔涓?寮€鍦虹涓€鍙?锛屽睍绀轰竴杞悗浜よ繕缁欐湰鍦版枃妗堝簱锛?    // 杩欐牱鏃繚鐣?瀹冪煡閬撲粖澶╂槸浠€涔堟棩瀛?鐨勬儕鍠滐紝涔熶笉浼氬洜涓烘帴鍙ｆ尝鍔ㄨ€屾柇娴併€?    if (engine.aiText) engine.setAIText(null);
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
 * 搴旂敤鐩镐綅銆傝繖鏄?鍒扮偣鑷姩鎺ョ"鐨勫敮涓€鍏ュ彛锛? * 瑙嗗浘鐨勬樉闅愬畬鍏ㄧ敱瀹冨喅瀹氾紝涓嶆帴鍙椾换浣曠敤鎴锋搷浣滅洿鎺ヤ慨鏀广€? */
async function applyPhase(snapshot) {
  const phase = effectivePhase(snapshot);
  let next = null;
  if (phase === core.PHASE.ACTIVE) next = "blackout";
  else if (phase === core.PHASE.WARNING) next = "warning";

  if (next === ui.overlay) return;
  const previous = ui.overlay;
  ui.overlay = next;
  // 鍔ㄧ敾鏄紓姝ョ殑锛屾湡闂寸浉浣嶅彲鑳藉張鍙樹簡锛涚敤浠ょ墝浣滃簾杩囨湡鐨勮繖娆″垏鎹?  const token = (ui.phaseToken += 1);

  if (next === "blackout") {
    document.body.classList.add("is-locked");
    // 璁板綍"浠婂ぉ鐪熸杩涘叆鐔勭伅"锛堝悓涓€鏃舵鍙涓€娆★紱婕旂ず妯″紡涓嶆薄鏌撶湡瀹炴暟鎹級
    if (!isDemo()) {
      const windowKey = snapshot.window?.startKey;
      if (windowKey && ui.lastRecordedWindowKey !== windowKey) {
        ui.lastRecordedWindowKey = windowKey;
        sleepRecords.record(core.dateKey(snapshot.at), { entered: true });
      }
    }
    if (previous !== "blackout") {
      // 鎷夌怀浠紡锛氭瘡涓唲鐏椂娈靛彧瑕佹眰涓€娆★紝鐢辩敤鎴蜂翰鎵嬫妸鐏怀鎷夊埌搴曘€?      //
      // 婕旂ず妯″紡璺宠繃 鈥斺€?閭ｆ槸缁欎汉"鐪嬩竴鐪兼晥鏋?鐨勫叆鍙ｏ紝澶氫竴姝ユ嫋鎷藉彧浼氱浜嬨€?      // 瓒呮椂鍏滃簳鍦?lamp.awaitPull 閲岋紝缁濅笉浼氭妸浜哄崱鍦ㄦ媺缁崇晫闈€?      const pullKey = snapshot.window?.startKey;
      if (!isDemo() && pullKey && ui.lastPulledWindowKey !== pullKey) {
        ui.lastPulledWindowKey = pullKey;
        await lamp.awaitPull();
        if (ui.phaseToken !== token) return;
      }
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
    if (isDemo()) toast("婕旂ず妯″紡宸插紑鍚紝2 鍒嗛挓鍚庤嚜鍔ㄧ粨鏉?);
    return;
  }

  if (next === "warning") {
    document.body.classList.add("is-locked");
    setHidden(warningView.root, false);
    setHidden(blackoutView.root, true);
    stopCopyRotation();
    return;
  }

  // 鍥炲埌鏅€氱晫闈?  document.body.classList.remove("is-locked");
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

/* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?6. 闃茬粫杩囧畧鍗紙PRD 涓夛級鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?*/

function beforeUnloadGuard(event) {
  event.preventDefault();
  event.returnValue = "";
}

async function installGuards() {
  // 婕旂ず妯″紡涓嬩笉瀹夎"鐢╀笉鎺?鐨勫畧鍗紝閬垮厤鎶婂彧鎯崇湅鐪嬫晥鏋滅殑浜哄洶鍦ㄧ晫闈㈤噷
  const demo = isDemo();

  if (!demo) {
    const trap = core.installHistoryTrap(window.history, () => toast("鐔勭伅妯″紡鏃犳硶閫氳繃杩斿洖閿€€鍑?));
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
      /* 鍗曚釜娓呯悊澶辫触涓嶅奖鍝嶅叾瀹?*/
    }
  }
  try {
    ui.wakeLockSentinel?.release?.();
  } catch {
    /* 鍞ら啋閿佸彲鑳藉凡琚郴缁熷洖鏀?*/
  }
  ui.wakeLockSentinel = null;
}

/**
 * 绯荤粺鏃堕棿绡℃敼妫€娴嬶紙PRD 涓夛級銆? * 涓€鏃﹀湪鐔勭伅鏈熼棿妫€鍑鸿烦鍙橈紝灏辨妸鐔勭伅鐘舵€佸喕缁撳埌"鍘熸湰鐨勬椂娈电粨鏉熸椂鍒?锛? * 杩欐牱鏃犺鐢ㄦ埛鎶婃椂闂村線鍓嶆嫧杩樻槸寰€鍚庢嫧锛岄兘鐢╀笉鎺夌唲鐏晫闈€? */
const clockGuard = core.createClockGuard({
  onJump: (event) => {
    if (!settingsStore.value.guard.detectClockTamper) return;
    const snapshot = engine.snapshot();
    if (effectivePhase(snapshot) !== core.PHASE.ACTIVE) return;
    const frozenEnd = ui.lastActiveWindowEnd ?? snapshot.window?.end ?? null;
    if (!frozenEnd) return;
    ui.freezeUntil = frozenEnd;
    toast(`妫€娴嬪埌绯荤粺鏃堕棿琚慨鏀癸紙${event.direction === "forward" ? "鍚戝墠" : "鍚戝悗"}锛夛紝宸叉仮澶嶇唲鐏ā寮廯, {
      type: "error",
      duration: 4200,
    });
    render();
  },
});

/* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?7. 娓叉煋涓庝富寰幆 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?*/

function render() {
  const snapshot = engine.snapshot();

  if (ui.screen === "onboarding") onboardingView.update(snapshot);
  else if (ui.screen === "profile") profileView.update(snapshot, uiApi);
  else homeView.update(snapshot, uiApi);

  if (ui.overlay === "blackout") blackoutView.update(snapshot, uiApi);
  else if (ui.overlay === "warning") warningView.update(snapshot);

  if (sheetsView.anyOpen) sheetsView.update(snapshot);

  // 鐔勭伅缁撴潫鍚庤嚜鍔ㄥ仠姝㈤煶棰戯紙PRD 2.3銆屾挱鏀剧粨鏉熷悗鑷姩鍋滄銆嶏級
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
  // applyPhase 鏄紓姝ョ殑锛堣绛夊叆鍦哄姩鐢伙級锛岃繖閲屼笉鑳?await 鈥斺€?鍚﹀垯涓诲惊鐜細琚姩鐢婚樆濉炪€?  // 浣嗗繀椤诲厹浣忓紓甯革紝鍚﹀垯涓€娆″け璐ュ氨浼氬彉鎴?unhandled rejection 骞惰鍚庣画甯ч潤榛樺け鏁堛€?  applyPhase(snapshot).catch((error) => {
    console.error("[xideng] 鐩镐綅鍒囨崲澶辫触", error);
  });
}

/* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?8. 鐢熷懡鍛ㄦ湡 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?*/

// 鍒囪蛋鍐嶅洖鏉ョ珛鍒婚噸鏂版帴绠★紙PRD 2.2.1 鐨?Web 绛夋晥瀹炵幇锛?document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  endWhitelistSession();
  if (settingsStore.value.guard.reassertOnVisible) tick();
});

// 鐔勭伅鐣岄潰鍐呯姝㈠彸閿彍鍗曪紝鍑忓皯"鍙﹀瓨/妫€鏌?杩欑被鑴辫韩璺緞
document.addEventListener("contextmenu", (event) => {
  if (ui.overlay === "blackout" && !event.target.closest("input, textarea")) event.preventDefault();
});

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const { protocol, hostname } = window.location;
  const secure = protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1";
  if (!secure) {
    // Service Worker 鍙湪瀹夊叏涓婁笅鏂囧彲鐢紱file:// 鐩存帴鎵撳紑鏃惰烦杩囧嵆鍙?    return;
  }
  try {
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  } catch (error) {
    console.info("[xideng] Service Worker 娉ㄥ唽澶辫触锛岀绾胯兘鍔涗笉鍙敤锛?, error);
  }
}

function boot() {
  // 鐗堟湰鍙峰彧鏈変竴澶勫畾涔夛紙瑙佹枃浠堕《閮ㄧ殑 APP_VERSION锛夛紝娉ㄥ叆鍒版墍鏈夐〉鑴氥€?  document.querySelectorAll("[data-app-version]").forEach((node) => {
    node.textContent = "v" + APP_VERSION;
  });

  applyScreen();
  if (ui.screen === "onboarding") onboardingView.show();
  // 绔嬪嵆鎵ц涓€娆★紝閬垮厤"鎵撳紑椤甸潰鍚庤绛?250ms 鎵嶈繘鍏ョ唲鐏晫闈?閫犳垚鐨勬椂闂存紡娲?  tick();
  setInterval(tick, TICK_MS);
  registerServiceWorker();
}

boot();

// 渚夸簬鍦ㄦ祻瑙堝櫒鎺у埗鍙版帓鏌ラ棶棰橈紱鐢熶骇浣跨敤涓笉渚濊禆瀹?window.__xideng = { core, settingsStore, quotaStore, budget, engine, ai, audio, ui, actions };

