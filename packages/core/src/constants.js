/**
 * 熄灯早睡 · 全局常量与默认设置
 *
 * 这里的 `DEFAULT_SETTINGS` 同时充当"设置项 schema"：
 * `settings.js` 依赖它做默认值填充与旧版本迁移，UI 也依赖它渲染初始状态。
 */

export const APP_NAME = "熄灯早睡";
export const APP_NAME_EN = "Lights Out";
export const APP_SLOGAN = "到点熄灯，把手机交还给睡眠";
export const VERSION = "1.0.0";

/** 设置结构版本号。改变默认结构时递增，`migrateSettings` 据此升级旧数据。 */
export const SETTINGS_VERSION = 1;

/** 工作日 / 周末两套独立熄灯时段 */
export const DAY_TYPE = {
  WEEKDAY: "weekday",
  WEEKEND: "weekend",
};

export const DAY_TYPE_LABELS = {
  [DAY_TYPE.WEEKDAY]: "工作日",
  [DAY_TYPE.WEEKEND]: "周末",
};

/** 引擎相位 */
export const PHASE = {
  /** 计划已关闭 */
  OFF: "off",
  /** 计划生效中，但距离熄灯开始尚早 */
  IDLE: "idle",
  /** 提前预告窗口内，全屏半透明弹窗 + 倒计时 */
  WARNING: "warning",
  /** 已进入强制熄灯模式 */
  ACTIVE: "active",
};

/** 提前提醒可选时长（分钟），PRD 2.1.2 */
export const WARN_MINUTE_OPTIONS = [10, 15, 30];

/** 白名单总可用时长上限（分钟），PRD 2.2.3 */
export const WHITELIST_TOTAL_MINUTES_MAX = 60;
export const WHITELIST_TOTAL_MINUTES_MIN = 5;

/**
 * 系统自带、默认加入白名单且不可移除的应用。
 * PRD 2.2.3 明确它们"无时长限制"，因此 `countsAgainstQuota: false`，
 * 不参与总时长扣减（这是对 PRD 中"共用总时长"与"无时长限制"两句话的调和解释）。
 */
export const SYSTEM_WHITELIST_APPS = [
  {
    id: "sys-phone",
    name: "电话",
    system: true,
    removable: false,
    countsAgainstQuota: false,
    uri: "tel:",
    description: "系统通话，不受熄灯限制，且不消耗白名单时长",
  },
  {
    id: "sys-sms",
    name: "短信",
    system: true,
    removable: false,
    countsAgainstQuota: false,
    uri: "sms:",
    description: "系统短信，不受熄灯限制，且不消耗白名单时长",
  },
];

/** 每周紧急解除额度，PRD 2.1.3 */
export const WEEKLY_QUOTA_TOTAL = 2;

/** 紧急解除触发：连续点击屏幕次数，PRD 2.2.5 */
export const EMERGENCY_TAP_COUNT = 5;
/** 连续点击的有效时间窗（毫秒）——超出视为重新计数 */
export const EMERGENCY_TAP_WINDOW_MS = 3000;

/** 忘记密码后的重置冷却：等待 24 小时才能清空密码。
 *  刻意**不**重置本周额度 —— 否则每 24 小时白送 2 次解除，每周额度会被彻底架空。 */
export const PASSWORD_RESET_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** 默认紧急解除密码。首次启动引导会要求用户修改。 */
export const DEFAULT_EMERGENCY_PASSWORD = "0000";

/** 核心动画时长，PRD 4.3：约 1.5 秒 */
export const ANIMATION_MS = 1500;

/** 黑屏界面文案轮播间隔 */
export const COPY_ROTATE_MS = 12_000;
export const COPY_FADE_MS = 900;

/** 熄灯时段内检测到时间被篡改时的容忍阈值（毫秒），PRD 三、防系统时间篡改 */
export const CLOCK_TAMPER_TOLERANCE_MS = 5_000;

/** 白名单应用运行时长的扣减精度（毫秒） */
export const WHITELIST_TICK_MS = 1000;

export const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,

  /** 睡眠计划，PRD 2.1 */
  plan: {
    enabled: true,
    windows: {
      [DAY_TYPE.WEEKDAY]: { start: "23:00", end: "07:00" },
      [DAY_TYPE.WEEKEND]: { start: "23:00", end: "07:00" },
    },
    warnMinutes: 15,
    /** 周日晚按工作日执行（默认开）：周一要早起，周日晚上不松懈 */
    sundayAsWeekday: true,
  },

  /** 黑屏界面表现 */
  blackout: {
    copyIntervalSec: COPY_ROTATE_MS / 1000,
    /** 文字亮度，0-1，对应 PRD 4.4"亮度适配夜间环境，不刺眼" */
    brightness: 0.62,
  },

  /** 白名单，PRD 2.2.3 */
  whitelist: {
    totalMinutes: 30,
    apps: [...SYSTEM_WHITELIST_APPS],
  },

  /** 助眠音频，PRD 2.3 */
  audio: {
    preset: "rain",
    volume: 0.6,
    /** 0 表示"持续播放至熄灯结束" */
    durationMinutes: 30,
    autoPlay: false,
  },

  /** AI 场景化文案，PRD 2.4。apiKey 仅保存在用户本机，绝不上传。 */
  ai: {
    enabled: false,
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKey: "",
    temperature: 0.9,
    timeoutMs: 12_000,
  },

  /** 紧急解除，PRD 2.1.3 / 2.2.5 */
  emergency: {
    /** WebCrypto SHA-256 摘要；空字符串表示尚未设置 */
    passwordHash: "",
    quotaTotal: WEEKLY_QUOTA_TOTAL,
    /** 忘记密码重置申请的时间戳（毫秒）；null 表示未申请。24 小时后自动清空密码（不影响本周额度） */
    passwordResetAt: null,
  },

  /** 防绕过，PRD 三 */
  guard: {
    /** 熄灯时段内离开页面时立即重新接管 */
    reassertOnVisible: true,
    /** 检测系统时间跳变（向前或向后） */
    detectClockTamper: true,
    /** 持有屏幕唤醒锁，避免熄屏中断计时 */
    wakeLock: true,
  },

  /** 首次使用引导是否已完成 */
  onboarded: false,
};
