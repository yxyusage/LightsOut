package com.xideng.sleep.core

import org.json.JSONObject
import java.time.LocalDate

/**
 * 熄灯早睡 · 每周解除额度（PRD 2.1.3）
 *
 * "自然周"按**周一 00:00 为起点**计算，因此直接把"该周周一的日期"当作周键，
 * 键一变即代表跨周，无需额外记录重置时间，也不怕用户改动系统时间以外的东西。
 *
 * 与 `packages/core/src/quota.js` 语义一致。
 */
class QuotaStore(
    private val storage: KeyValueStore,
    private val key: String = Constants.KEY_QUOTA,
    total: Int = Constants.WEEKLY_QUOTA_TOTAL,
) {

    data class ConsumeResult(val ok: Boolean, val remaining: Int, val reason: String?)

    data class Snapshot(val weekKey: String?, val total: Int, val used: Int, val remaining: Int)

    private var weekKey: String? = null
    private var used: Int = 0
    private var totalCount: Int = total

    init {
        load()
        if (weekKey == null) persist()
    }

    private fun load() {
        try {
            val raw = storage.getString(key)
            if (raw.isNullOrEmpty()) return
            val parsed = JSONObject(raw)
            weekKey = if (parsed.isNull("weekKey")) null else parsed.optString("weekKey", "").ifEmpty { null }
            used = maxOf(0, parsed.optInt("used", 0))
            totalCount = maxOf(0, parsed.optInt("total", totalCount))
        } catch (error: Exception) {
            // 数据损坏时静默回退到全新状态，绝不因为存储异常把用户锁死
            weekKey = null
            used = 0
        }
    }

    private fun persist() {
        try {
            val json = JSONObject()
            json.put("weekKey", weekKey ?: JSONObject.NULL)
            json.put("used", used)
            json.put("total", totalCount)
            storage.putString(key, json.toString())
        } catch (error: Exception) {
            // 存储不可用时退化为本次会话内有效
        }
    }

    /** 跨周则清零（PRD 2.1.3 的自然周重置）。返回是否发生了重置。 */
    fun sync(now: LocalDate): Boolean {
        val current = weekKeyOf(now)
        if (weekKey != current) {
            weekKey = current
            used = 0
            persist()
            return true
        }
        return false
    }

    /** 剩余次数 */
    fun remaining(now: LocalDate): Int {
        sync(now)
        return maxOf(0, totalCount - used)
    }

    fun isAvailable(now: LocalDate): Boolean = remaining(now) > 0

    /** 消费一次额度 */
    fun consume(now: LocalDate): ConsumeResult {
        sync(now)
        if (totalCount - used <= 0) {
            return ConsumeResult(false, 0, "本周解除额度已用完")
        }
        used += 1
        persist()
        return ConsumeResult(true, maxOf(0, totalCount - used), null)
    }

    /** 完整快照，供"个人中心"展示（PRD 2.1.3） */
    fun snapshot(now: LocalDate): Snapshot {
        sync(now)
        return Snapshot(weekKey, totalCount, used, maxOf(0, totalCount - used))
    }

    /** 调试与"重置本周额度"入口使用 */
    fun reset(now: LocalDate) {
        weekKey = weekKeyOf(now)
        used = 0
        persist()
    }

    fun setTotal(next: Int) {
        totalCount = maxOf(0, next)
        persist()
    }

    companion object {
        /** 该日期所在自然周的周一 */
        fun startOfWeek(date: LocalDate): LocalDate = date.minusDays((date.dayOfWeek.value - 1).toLong())

        /** 周键，例如 `"2026-08-31"`，表示 2026-08-31 那一周 */
        fun weekKeyOf(date: LocalDate): String = TimeUtils.dateKey(startOfWeek(date))
    }
}
