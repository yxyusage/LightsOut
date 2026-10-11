package com.xideng.sleep.core

import org.json.JSONObject
import java.time.Instant

/**
 * 熄灯早睡 · 白名单可用时长预算（PRD 2.2.3）
 *
 * PRD 的三条规则在这里落地：
 *  1. "所有白名单应用共用总可用时长" → 单一预算池，与具体应用无关；
 *  2. "总时长耗尽后……当日无法再使用任何白名单应用" → 按"计费周期"重置；
 *  3. 系统电话/短信"无时长限制" → 由 countsAgainstQuota = false 标记，压根不进这个池子。
 *
 * ⚠️ 关于"当日"的语义澄清（这是 PRD 中一处真实的自相矛盾）
 * ---------------------------------------------------------------
 * PRD 2.2.3 说耗尽后"**当日**无法再使用"，字面理解是按日历日、0 点重置。
 * 但熄灯时段默认是 23:00 → 次日 07:00，**横跨午夜**。若真的在 0 点重置，
 * 用户只要在 23:50 用掉 30 分钟、0:10 再拿 30 分钟，就能在同一次熄灯里用掉双倍额度。
 *
 * 因此本模块把"计费周期"抽象为**由调用方注入的 periodKey**：
 *  - 默认实现按日历日重置，严格贴合 PRD 字面语义；
 *  - 应用层实际传入**当前熄灯时段的开始日**（`SleepWindow.startKey`）：
 *    这样一次熄灯（哪怕跨过午夜）共用一个额度池，下一次熄灯开始时自然重置。
 *
 * 与 `packages/core/src/whitelist.js` 语义一致。
 */
class WhitelistBudget(
    private val storage: KeyValueStore,
    private val key: String = Constants.KEY_WHITELIST_USAGE,
    private val totalMinutesProvider: () -> Int = { 30 },
    private val periodKeyProvider: (Instant) -> String = { TimeUtils.dateKey(TimeUtils.localDate(it)) },
) {

    data class ChargeResult(val ok: Boolean, val remainingMs: Long, val exhausted: Boolean)

    data class Snapshot(
        val periodKey: String?,
        val totalMs: Long,
        val usedMs: Long,
        val remainingMs: Long,
        val exhausted: Boolean,
    )

    private var periodKey: String? = null
    private var usedMs: Long = 0L

    init {
        load()
        if (periodKey == null) persist()
    }

    private fun load() {
        try {
            val raw = storage.getString(key)
            if (raw.isNullOrEmpty()) return
            val parsed = JSONObject(raw)
            periodKey = if (parsed.isNull("periodKey")) null else parsed.optString("periodKey", "").ifEmpty { null }
            val parsedUsed = parsed.optDouble("usedMs", 0.0)
            usedMs = if (parsedUsed.isNaN() || parsedUsed < 0.0) 0L else parsedUsed.toLong()
        } catch (error: Exception) {
            // 数据损坏 → 视为本周期尚未使用，避免用户被永久锁死
            periodKey = null
            usedMs = 0L
        }
    }

    private fun persist() {
        try {
            val json = JSONObject()
            json.put("periodKey", periodKey ?: JSONObject.NULL)
            json.put("usedMs", usedMs)
            storage.putString(key, json.toString())
        } catch (error: Exception) {
            // 存储不可用时退化为会话内有效
        }
    }

    /** 周期切换则清零。返回是否发生了重置。 */
    fun sync(at: Instant): Boolean {
        val current = periodKeyProvider(at)
        if (periodKey != current) {
            periodKey = current
            usedMs = 0L
            persist()
            return true
        }
        return false
    }

    private fun totalMs(): Long {
        val minutes = totalMinutesProvider()
        return if (minutes > 0) minutes.toLong() * TimeUtils.MS_MINUTE else 0L
    }

    fun usedMs(at: Instant): Long {
        sync(at)
        return usedMs
    }

    fun remainingMs(at: Instant): Long {
        sync(at)
        return maxOf(0L, totalMs() - usedMs)
    }

    fun isExhausted(at: Instant): Boolean = remainingMs(at) <= 0L

    /** 扣减使用时长 */
    fun charge(deltaMs: Long, at: Instant): ChargeResult {
        sync(at)
        if (deltaMs > 0L) {
            usedMs = minOf(totalMs(), usedMs + deltaMs)
            persist()
        }
        val remaining = maxOf(0L, totalMs() - usedMs)
        return ChargeResult(remaining > 0L, remaining, remaining <= 0L)
    }

    fun snapshot(at: Instant): Snapshot {
        sync(at)
        val total = totalMs()
        val remaining = maxOf(0L, total - usedMs)
        return Snapshot(periodKey, total, usedMs, remaining, remaining <= 0L)
    }

    /** 调试与测试用：清空本周期用量 */
    fun reset(at: Instant) {
        periodKey = periodKeyProvider(at)
        usedMs = 0L
        persist()
    }
}
