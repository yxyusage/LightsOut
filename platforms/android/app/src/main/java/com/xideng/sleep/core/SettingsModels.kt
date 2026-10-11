package com.xideng.sleep.core

/**
 * 熄灯早睡 · 设置模型
 *
 * 与 `packages/core/src/constants.js` 的 `DEFAULT_SETTINGS` 结构一一对应。
 * 这里的默认值同时充当"设置项 schema"：迁移逻辑依赖它做默认值填充。
 * 所有字段都是 val，修改通过 `copy()` 产生新对象，便于 UI 层比较是否变化。
 */

data class PlanWindow(val start: String, val end: String)

fun defaultPlanWindows(): Map<DayType, PlanWindow> = mapOf(
    DayType.WEEKDAY to PlanWindow("23:00", "07:00"),
    DayType.WEEKEND to PlanWindow("23:00", "07:00"),
)

data class PlanSettings(
    val enabled: Boolean = true,
    val windows: Map<DayType, PlanWindow> = defaultPlanWindows(),
    val warnMinutes: Int = 15,
) {
    fun windowOf(dayType: DayType): PlanWindow? = windows[dayType]

    fun withWindow(dayType: DayType, window: PlanWindow): PlanSettings =
        copy(windows = windows.toMutableMap().apply { put(dayType, window) })
}

data class BlackoutSettings(
    val copyIntervalSec: Int = 12,
    /** 文字亮度，0-1，对应 PRD 4.4"亮度适配夜间环境，不刺眼" */
    val brightness: Double = 0.62,
    /**
     * 黑屏界面渲染方式：
     *  - `auto`    资产存在时用 WebView，否则用原生布局（默认）
     *  - `webview` 强制 WebView，失败时自动退回原生
     *  - `native`  始终用原生布局
     */
    val renderMode: String = RENDER_AUTO,
) {
    companion object {
        const val RENDER_AUTO = "auto"
        const val RENDER_NATIVE = "native"
        const val RENDER_WEBVIEW = "webview"
    }
}

/**
 * 白名单应用。
 *
 * 相比 Web 版多了一个 `packageName`：Web 端用 `url` 打开页面，
 * Android 端必须用包名拉起真实应用。`uri` 保留给 `tel:` / `sms:` 这类系统动作。
 */
data class WhitelistApp(
    val id: String,
    val name: String,
    val system: Boolean = false,
    val removable: Boolean = true,
    val countsAgainstQuota: Boolean = true,
    val packageName: String = "",
    val uri: String = "",
    val url: String = "",
    val description: String = "",
)

/** PRD 2.2.3：系统自带电话、短信默认加入白名单且不可移除、无时长限制。 */
object SystemWhitelistApps {
    val ALL: List<WhitelistApp> = listOf(
        WhitelistApp(
            id = "sys-phone",
            name = "电话",
            system = true,
            removable = false,
            countsAgainstQuota = false,
            uri = "tel:",
            description = "系统通话，不受熄灯限制，且不消耗白名单时长",
        ),
        WhitelistApp(
            id = "sys-sms",
            name = "短信",
            system = true,
            removable = false,
            countsAgainstQuota = false,
            uri = "sms:",
            description = "系统短信，不受熄灯限制，且不消耗白名单时长",
        ),
    )
}

data class WhitelistSettings(
    val totalMinutes: Int = 30,
    val apps: List<WhitelistApp> = SystemWhitelistApps.ALL,
)

data class AudioSettings(
    val preset: String = "rain",
    val volume: Double = 0.6,
    /** 0 表示"持续播放至熄灯结束"（PRD 2.3） */
    val durationMinutes: Int = 30,
    val autoPlay: Boolean = false,
)

/** PRD 2.4：apiKey 仅保存在用户本机 SharedPreferences，绝不上传。 */
data class AiSettings(
    val enabled: Boolean = false,
    val baseUrl: String = "https://api.openai.com/v1",
    val model: String = "gpt-4o-mini",
    val apiKey: String = "",
    val temperature: Double = 0.9,
    val timeoutMs: Int = 12_000,
)

/** PRD 2.1.3 / 2.2.5 */
data class EmergencySettings(
    /** SHA-256 十六进制摘要；空字符串表示尚未设置 */
    val passwordHash: String = "",
    val quotaTotal: Int = Constants.WEEKLY_QUOTA_TOTAL,
)

/** 防绕过开关，PRD 三 */
data class GuardSettings(
    val reassertOnVisible: Boolean = true,
    val detectClockTamper: Boolean = true,
    val wakeLock: Boolean = true,
)

data class Settings(
    val version: Int = Constants.SETTINGS_VERSION,
    val plan: PlanSettings = PlanSettings(),
    val blackout: BlackoutSettings = BlackoutSettings(),
    val whitelist: WhitelistSettings = WhitelistSettings(),
    val audio: AudioSettings = AudioSettings(),
    val ai: AiSettings = AiSettings(),
    val emergency: EmergencySettings = EmergencySettings(),
    val guard: GuardSettings = GuardSettings(),
    val onboarded: Boolean = false,
)
