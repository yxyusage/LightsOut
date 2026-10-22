package com.xideng.sleep.core

/**
 * 熄灯早睡 · 全局常量与默认值
 *
 * 与 `packages/core/src/constants.js` 一一对应。任何影响"什么时间算熄灯、额度怎么扣"
 * 的数值都必须在这里改，不要在 UI 层硬编码。
 */
object Constants {

    const val APP_NAME = "熄灯早睡"
    const val APP_NAME_EN = "Lights Out"
    const val APP_SLOGAN = "到点熄灯，把手机交还给睡眠"
    const val VERSION = "1.0.0"

    /** 设置结构版本号。改变默认结构时递增，迁移逻辑据此升级旧数据。 */
    const val SETTINGS_VERSION = 1

    /** 提前提醒可选时长（分钟），PRD 2.1.2 */
    val WARN_MINUTE_OPTIONS = intArrayOf(10, 15, 30)

    /** 白名单总可用时长上限（分钟），PRD 2.2.3 */
    const val WHITELIST_TOTAL_MINUTES_MAX = 60
    const val WHITELIST_TOTAL_MINUTES_MIN = 5
    const val MAX_WHITELIST_APPS = 30

    /** 每周紧急解除额度，PRD 2.1.3 */
    const val WEEKLY_QUOTA_TOTAL = 2

    /** 紧急解除触发：连续点击屏幕次数与有效时间窗，PRD 2.2.5 */
    const val EMERGENCY_TAP_COUNT = 5
    const val EMERGENCY_TAP_WINDOW_MS = 3_000L

    /** 默认紧急解除密码。首次启动引导会要求用户修改。 */
    const val DEFAULT_EMERGENCY_PASSWORD = "0000"

    /** 核心动画时长，PRD 4.3：约 1.5 秒 */
    const val ANIMATION_MS = 1_500L

    /** 黑屏界面文案轮播参数 */
    const val COPY_ROTATE_MS = 12_000L
    const val COPY_FADE_MS = 900L

    /** 时间被篡改的容忍阈值（毫秒），PRD 三 */
    const val CLOCK_TAMPER_TOLERANCE_MS = 5_000L

    /** 白名单应用运行时长的扣减精度（毫秒） */
    const val WHITELIST_TICK_MS = 1_000L

    /** 违规记录上限，避免长期使用后无限增长 */
    const val MAX_TAMPER_EVENTS = 50

    /* ── 存储键（与 Web 版命名保持一致，便于两端排查同一份数据语义）── */
    const val PREFS_FILE = "xideng_store"
    const val KEY_SETTINGS = "xideng.settings.v1"
    const val KEY_QUOTA = "quota"
    const val KEY_WHITELIST_USAGE = "xideng.whitelist.usage.v1"
    const val KEY_GUARD = "xideng.guard.v1"
    const val KEY_AI_CACHE = "xideng.ai.cache.v1"

    /* ── 通知 ── */
    const val CHANNEL_LOCK = "xideng.channel.lock"
    const val CHANNEL_AUDIO = "xideng.channel.audio"
    const val CHANNEL_ALERT = "xideng.channel.alert"
    const val NOTIFICATION_ID_LOCK = 1001
    const val NOTIFICATION_ID_AUDIO = 1002
    const val NOTIFICATION_ID_WARNING = 1003

    /**
     * 防护降级提醒（无障碍被关、电池优化未豁免）。
     *
     * 独立于主通知：主通知是"计划运行中"的常驻状态，
     * 这条是"出问题了，你需要处理"，两者不该互相覆盖。
     */
    const val NOTIFICATION_ID_DEGRADED = 1004
}

/** 工作日 / 周末两套独立熄灯时段（PRD 2.1.1） */
enum class DayType(val id: String, val label: String) {
    WEEKDAY("weekday", "工作日"),
    WEEKEND("weekend", "周末");

    companion object {
        fun fromId(id: String?): DayType = entries.firstOrNull { it.id == id } ?: WEEKDAY
    }
}

/** 引擎相位。`phaseAt()` 是整个应用唯一的时间判定出口。 */
enum class Phase(val id: String) {
    /** 计划已关闭 */
    OFF("off"),

    /** 计划生效中，但距离熄灯开始尚早 */
    IDLE("idle"),

    /** 提前预告窗口内，全屏半透明弹窗 + 倒计时 */
    WARNING("warning"),

    /** 已进入强制熄灯模式 */
    ACTIVE("active"),
}
