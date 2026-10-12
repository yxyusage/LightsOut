package com.xideng.sleep.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * 熄灯早睡 · 设置读写与版本迁移
 *
 * 设置是"用户唯一需要长期信任的数据"，因此这里的重点是可恢复性：
 * 任何字段缺失、类型错误、版本过期，都通过 [SettingsJson.migrate] 收敛到合法状态，
 * 而不是把问题抛给上层 UI。
 *
 * 与 `packages/core/src/settings.js` 语义一致。
 */
object SettingsJson {

    fun toJson(settings: Settings): JSONObject {
        val root = JSONObject()
        root.put("version", settings.version)

        val plan = JSONObject()
        plan.put("enabled", settings.plan.enabled)
        val windows = JSONObject()
        for (dayType in DayType.entries) {
            val window = settings.plan.windows[dayType] ?: PlanWindow("23:00", "07:00")
            val item = JSONObject()
            item.put("start", window.start)
            item.put("end", window.end)
            windows.put(dayType.id, item)
        }
        plan.put("windows", windows)
        plan.put("warnMinutes", settings.plan.warnMinutes)
        root.put("plan", plan)

        val blackout = JSONObject()
        blackout.put("copyIntervalSec", settings.blackout.copyIntervalSec)
        blackout.put("brightness", settings.blackout.brightness)
        blackout.put("renderMode", settings.blackout.renderMode)
        root.put("blackout", blackout)

        val whitelist = JSONObject()
        whitelist.put("totalMinutes", settings.whitelist.totalMinutes)
        val apps = JSONArray()
        for (app in settings.whitelist.apps) apps.put(appToJson(app))
        whitelist.put("apps", apps)
        root.put("whitelist", whitelist)

        val audio = JSONObject()
        audio.put("preset", settings.audio.preset)
        audio.put("volume", settings.audio.volume)
        audio.put("durationMinutes", settings.audio.durationMinutes)
        audio.put("autoPlay", settings.audio.autoPlay)
        root.put("audio", audio)

        val ai = JSONObject()
        ai.put("enabled", settings.ai.enabled)
        ai.put("baseUrl", settings.ai.baseUrl)
        ai.put("model", settings.ai.model)
        ai.put("apiKey", settings.ai.apiKey)
        ai.put("temperature", settings.ai.temperature)
        ai.put("timeoutMs", settings.ai.timeoutMs)
        root.put("ai", ai)

        val emergency = JSONObject()
        emergency.put("passwordHash", settings.emergency.passwordHash)
        emergency.put("quotaTotal", settings.emergency.quotaTotal)
        root.put("emergency", emergency)

        val guard = JSONObject()
        guard.put("reassertOnVisible", settings.guard.reassertOnVisible)
        guard.put("detectClockTamper", settings.guard.detectClockTamper)
        guard.put("wakeLock", settings.guard.wakeLock)
        root.put("guard", guard)

        root.put("onboarded", settings.onboarded)
        return root
    }

    fun fromJson(raw: JSONObject?): Settings {
        val planRaw = child(raw, "plan")
        val windowsRaw = child(planRaw, "windows")
        val windowMap = LinkedHashMap<DayType, PlanWindow>()
        for (dayType in DayType.entries) {
            val item = child(windowsRaw, dayType.id)
            val fallback = defaultPlanWindows().getValue(dayType)
            windowMap[dayType] = PlanWindow(
                start = readString(item, "start", fallback.start),
                end = readString(item, "end", fallback.end),
            )
        }

        val whitelistRaw = child(raw, "whitelist")
        val appsRaw = if (whitelistRaw == null || whitelistRaw.isNull("apps")) null else whitelistRaw.optJSONArray("apps")
        val apps = mutableListOf<WhitelistApp>()
        if (appsRaw != null) {
            for (index in 0 until appsRaw.length()) {
                val item = appsRaw.optJSONObject(index) ?: continue
                val id = readString(item, "id", "")
                val name = readString(item, "name", "")
                if (id.isEmpty() || name.isEmpty()) continue
                apps.add(
                    WhitelistApp(
                        id = id,
                        name = name,
                        system = readBoolean(item, "system", false),
                        removable = readBoolean(item, "removable", true),
                        countsAgainstQuota = readBoolean(item, "countsAgainstQuota", true),
                        packageName = readString(item, "packageName", ""),
                        uri = readString(item, "uri", ""),
                        url = readString(item, "url", ""),
                        description = readString(item, "description", ""),
                    ),
                )
            }
        }

        val audioRaw = child(raw, "audio")
        val aiRaw = child(raw, "ai")
        val emergencyRaw = child(raw, "emergency")
        val guardRaw = child(raw, "guard")
        val blackoutRaw = child(raw, "blackout")

        return Settings(
            version = readInt(raw, "version", Constants.SETTINGS_VERSION),
            plan = PlanSettings(
                // 缺省必须与 PlanSettings.enabled 保持一致，否则反序列化会把它读回 true
                enabled = readBoolean(planRaw, "enabled", false),
                windows = windowMap,
                warnMinutes = readInt(planRaw, "warnMinutes", 15),
            ),
            blackout = BlackoutSettings(
                copyIntervalSec = readInt(blackoutRaw, "copyIntervalSec", 12),
                brightness = readDouble(blackoutRaw, "brightness", 0.62),
                renderMode = readString(blackoutRaw, "renderMode", BlackoutSettings.RENDER_AUTO),
            ),
            whitelist = WhitelistSettings(
                totalMinutes = readInt(whitelistRaw, "totalMinutes", 30),
                apps = apps,
            ),
            audio = AudioSettings(
                preset = readString(audioRaw, "preset", "rain"),
                volume = readDouble(audioRaw, "volume", 0.6),
                durationMinutes = readInt(audioRaw, "durationMinutes", 30),
                autoPlay = readBoolean(audioRaw, "autoPlay", false),
            ),
            ai = AiSettings(
                enabled = readBoolean(aiRaw, "enabled", false),
                baseUrl = readString(aiRaw, "baseUrl", "https://api.openai.com/v1"),
                model = readString(aiRaw, "model", "gpt-4o-mini"),
                apiKey = readString(aiRaw, "apiKey", ""),
                temperature = readDouble(aiRaw, "temperature", 0.9),
                timeoutMs = readInt(aiRaw, "timeoutMs", 12_000),
            ),
            emergency = EmergencySettings(
                passwordHash = readString(emergencyRaw, "passwordHash", ""),
                quotaTotal = readInt(emergencyRaw, "quotaTotal", Constants.WEEKLY_QUOTA_TOTAL),
            ),
            guard = GuardSettings(
                reassertOnVisible = readBoolean(guardRaw, "reassertOnVisible", true),
                detectClockTamper = readBoolean(guardRaw, "detectClockTamper", true),
                wakeLock = readBoolean(guardRaw, "wakeLock", true),
            ),
            onboarded = readBoolean(raw, "onboarded", false),
        )
    }

    /** 把任意输入收敛为合法的设置对象。数值一律夹到安全区间，非法枚举回退到默认值。 */
    fun migrate(input: Settings): Settings {
        val defaults = Settings()

        val windows = LinkedHashMap<DayType, PlanWindow>()
        for (dayType in DayType.entries) {
            val candidate = input.plan.windows[dayType]
            val fallback = defaults.plan.windows.getValue(dayType)
            windows[dayType] = if (candidate == null || Schedule.validateWindow(candidate.start, candidate.end).any {
                    it.startsWith("开始时间格式") || it.startsWith("结束时间格式")
                }
            ) {
                fallback
            } else {
                candidate
            }
        }

        val apps = input.whitelist.apps
            .filter { it.id.isNotBlank() && it.name.isNotBlank() }
            .map { app ->
                // 系统应用必须始终不可移除、不占额度（PRD 2.2.3）
                if (app.system) app.copy(removable = false, countsAgainstQuota = false) else app
            }
            .toMutableList()
        for (systemApp in SystemWhitelistApps.ALL) {
            val index = apps.indexOfFirst { it.id == systemApp.id }
            if (index < 0) apps.add(0, systemApp) else apps[index] = systemApp
        }

        val renderMode = when (input.blackout.renderMode) {
            BlackoutSettings.RENDER_NATIVE, BlackoutSettings.RENDER_WEBVIEW -> input.blackout.renderMode
            else -> BlackoutSettings.RENDER_AUTO
        }

        return Settings(
            version = Constants.SETTINGS_VERSION,
            plan = PlanSettings(
                enabled = input.plan.enabled,
                windows = windows,
                warnMinutes = clampInt(input.plan.warnMinutes, 0, 120, defaults.plan.warnMinutes),
            ),
            blackout = BlackoutSettings(
                copyIntervalSec = clampInt(input.blackout.copyIntervalSec, 5, 120, defaults.blackout.copyIntervalSec),
                brightness = clampDouble(input.blackout.brightness, 0.15, 1.0, defaults.blackout.brightness),
                renderMode = renderMode,
            ),
            whitelist = WhitelistSettings(
                totalMinutes = clampInt(
                    input.whitelist.totalMinutes,
                    Constants.WHITELIST_TOTAL_MINUTES_MIN,
                    Constants.WHITELIST_TOTAL_MINUTES_MAX,
                    defaults.whitelist.totalMinutes,
                ),
                apps = apps,
            ),
            audio = AudioSettings(
                preset = input.audio.preset,
                volume = clampDouble(input.audio.volume, 0.0, 1.0, defaults.audio.volume),
                durationMinutes = clampInt(input.audio.durationMinutes, 0, 600, defaults.audio.durationMinutes),
                autoPlay = input.audio.autoPlay,
            ),
            ai = AiSettings(
                enabled = input.ai.enabled,
                baseUrl = input.ai.baseUrl.ifBlank { defaults.ai.baseUrl },
                model = input.ai.model.ifBlank { defaults.ai.model },
                apiKey = input.ai.apiKey,
                temperature = clampDouble(input.ai.temperature, 0.0, 2.0, defaults.ai.temperature),
                timeoutMs = clampInt(input.ai.timeoutMs, 2_000, 60_000, defaults.ai.timeoutMs),
            ),
            emergency = EmergencySettings(
                passwordHash = input.emergency.passwordHash,
                quotaTotal = clampInt(input.emergency.quotaTotal, 0, 14, defaults.emergency.quotaTotal),
            ),
            guard = GuardSettings(
                reassertOnVisible = input.guard.reassertOnVisible,
                detectClockTamper = input.guard.detectClockTamper,
                wakeLock = input.guard.wakeLock,
            ),
            onboarded = input.onboarded,
        )
    }

    private fun appToJson(app: WhitelistApp): JSONObject {
        val item = JSONObject()
        item.put("id", app.id)
        item.put("name", app.name)
        item.put("system", app.system)
        item.put("removable", app.removable)
        item.put("countsAgainstQuota", app.countsAgainstQuota)
        item.put("packageName", app.packageName)
        item.put("uri", app.uri)
        item.put("url", app.url)
        item.put("description", app.description)
        return item
    }

    private fun child(raw: JSONObject?, name: String): JSONObject? {
        if (raw == null || raw.isNull(name)) return null
        return raw.optJSONObject(name)
    }

    private fun readInt(raw: JSONObject?, name: String, fallback: Int): Int {
        if (raw == null || !raw.has(name) || raw.isNull(name)) return fallback
        val value = raw.optDouble(name, Double.NaN)
        if (value.isNaN() || value.isInfinite()) return fallback
        return value.toInt()
    }

    private fun readDouble(raw: JSONObject?, name: String, fallback: Double): Double {
        if (raw == null || !raw.has(name) || raw.isNull(name)) return fallback
        val value = raw.optDouble(name, Double.NaN)
        if (value.isNaN() || value.isInfinite()) return fallback
        return value
    }

    private fun readBoolean(raw: JSONObject?, name: String, fallback: Boolean): Boolean {
        if (raw == null || !raw.has(name) || raw.isNull(name)) return fallback
        return raw.optBoolean(name, fallback)
    }

    private fun readString(raw: JSONObject?, name: String, fallback: String): String {
        if (raw == null || !raw.has(name) || raw.isNull(name)) return fallback
        return raw.optString(name, fallback)
    }

    private fun clampInt(value: Int, min: Int, max: Int, fallback: Int): Int {
        if (value == Int.MIN_VALUE || value == Int.MAX_VALUE) return fallback
        return minOf(max, maxOf(min, value))
    }

    private fun clampDouble(value: Double, min: Double, max: Double, fallback: Double): Double {
        if (value.isNaN() || value.isInfinite()) return fallback
        return minOf(max, maxOf(min, value))
    }
}

/**
 * 设置仓库。subscribe 让多个界面（设置页、黑屏页、个人中心）保持一致。
 */
class SettingsStore(
    private val storage: KeyValueStore,
    private val key: String = Constants.KEY_SETTINGS,
) {

    private val listeners = mutableListOf<(Settings) -> Unit>()
    private var currentValue: Settings = Settings()

    init {
        currentValue = SettingsJson.migrate(SettingsJson.fromJson(readRaw()))
        // 首次读取即落一次迁移结果，保证磁盘上永远是当前版本的结构
        persist()
    }

    val value: Settings get() = currentValue

    private fun readRaw(): JSONObject? {
        return try {
            val raw = storage.getString(key)
            if (raw.isNullOrEmpty()) null else JSONObject(raw)
        } catch (error: Exception) {
            // 数据损坏 → 用默认值覆盖，保证应用始终能启动
            try {
                storage.remove(key)
            } catch (ignored: Exception) {
                // 忽略
            }
            null
        }
    }

    private fun persist() {
        try {
            storage.putString(key, SettingsJson.toJson(currentValue).toString())
        } catch (error: Exception) {
            // 存储不可用时退化为会话内有效
        }
    }

    private fun emit() {
        for (listener in listeners.toList()) {
            try {
                listener(currentValue)
            } catch (error: Exception) {
                // 单个订阅者出错不应影响其它订阅者
            }
        }
    }

    /** 事务式更新：在旧值基础上派生新值 */
    fun update(transform: (Settings) -> Settings): Settings {
        currentValue = SettingsJson.migrate(transform(currentValue))
        persist()
        emit()
        return currentValue
    }

    fun replace(next: Settings): Settings {
        currentValue = SettingsJson.migrate(next)
        persist()
        emit()
        return currentValue
    }

    fun reset(): Settings {
        currentValue = SettingsJson.migrate(Settings())
        persist()
        emit()
        return currentValue
    }

    fun subscribe(listener: (Settings) -> Unit): () -> Unit {
        listeners.add(listener)
        return { listeners.remove(listener) }
    }
}
