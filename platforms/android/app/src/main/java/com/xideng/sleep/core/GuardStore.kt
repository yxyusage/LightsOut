package com.xideng.sleep.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * 熄灯早睡 · 防绕过状态（PRD 三）
 *
 * 这里保存三类状态，全部只在本机：
 *
 *  1. **已解除的时段键**：紧急解除只作用于"当前这一次"时段，次日计划照常生效（PRD 2.2.5）；
 *  2. **剩余时长锚点**：进入熄灯时记录"当时还剩多久"以及两个时钟的读数。
 *     剩余时长 = 锚点剩余 − 单调时钟的增量，因此**用户改系统时间无法重置剩余时长**（PRD 三）；
 *  3. **违规记录**：检测到时间跳变时留痕，供设置页展示。
 *
 * 时钟被抽象为可注入的 lambda，因此本类不依赖任何 Android API，可在 JVM 上测试。
 * 应用层注入 `SystemClock.elapsedRealtime()`（含深睡、不受改时间影响）。
 */
class GuardStore(
    private val storage: KeyValueStore,
    private val key: String = Constants.KEY_GUARD,
    private val wallClock: () -> Long = { System.currentTimeMillis() },
    private val monotonicClock: () -> Long = { System.nanoTime() / 1_000_000L },
) {

    /** 锚点：记录"进入熄灯那一刻"的三元组 */
    data class Anchor(val wallMs: Long, val elapsedMs: Long, val remainingMs: Long, val startKey: String)

    data class TamperEvent(val atMs: Long, val direction: String, val driftMs: Long)

    private var dismissedWindowKey: String? = null
    private var anchor: Anchor? = null
    private val tamperEvents = mutableListOf<TamperEvent>()

    init {
        load()
    }

    /* ───────────── 持久化 ───────────── */

    private fun load() {
        try {
            val raw = storage.getString(key)
            if (raw.isNullOrEmpty()) return
            val root = JSONObject(raw)

            dismissedWindowKey =
                if (root.isNull("dismissedWindowKey")) null
                else root.optString("dismissedWindowKey", "").ifEmpty { null }

            if (!root.isNull("anchor")) {
                val item = root.optJSONObject("anchor")
                if (item != null) {
                    anchor = Anchor(
                        wallMs = item.optDouble("wallMs", 0.0).toLong(),
                        elapsedMs = item.optDouble("elapsedMs", 0.0).toLong(),
                        remainingMs = item.optDouble("remainingMs", 0.0).toLong(),
                        startKey = item.optString("startKey", ""),
                    )
                }
            }

            val events = if (root.isNull("tamperEvents")) null else root.optJSONArray("tamperEvents")
            if (events != null) {
                for (index in 0 until events.length()) {
                    val item = events.optJSONObject(index) ?: continue
                    tamperEvents.add(
                        TamperEvent(
                            atMs = item.optDouble("atMs", 0.0).toLong(),
                            direction = item.optString("direction", "unknown"),
                            driftMs = item.optDouble("driftMs", 0.0).toLong(),
                        ),
                    )
                }
            }
        } catch (error: Exception) {
            // 数据损坏时以全新状态继续：防绕过状态失效好过应用无法启动
            dismissedWindowKey = null
            anchor = null
            tamperEvents.clear()
        }
    }

    private fun persist() {
        try {
            val root = JSONObject()
            root.put("dismissedWindowKey", dismissedWindowKey ?: JSONObject.NULL)

            val current = anchor
            if (current == null) {
                root.put("anchor", JSONObject.NULL)
            } else {
                val item = JSONObject()
                item.put("wallMs", current.wallMs)
                item.put("elapsedMs", current.elapsedMs)
                item.put("remainingMs", current.remainingMs)
                item.put("startKey", current.startKey)
                root.put("anchor", item)
            }

            val events = JSONArray()
            for (event in tamperEvents) {
                val item = JSONObject()
                item.put("atMs", event.atMs)
                item.put("direction", event.direction)
                item.put("driftMs", event.driftMs)
                events.put(item)
            }
            root.put("tamperEvents", events)

            storage.putString(key, root.toString())
        } catch (error: Exception) {
            // 忽略
        }
    }

    /* ───────────── 已解除时段 ───────────── */

    fun getDismissedWindowKey(): String? = dismissedWindowKey

    fun setDismissedWindowKey(value: String?) {
        dismissedWindowKey = value
        persist()
    }

    /* ───────────── 剩余时长锚点 ───────────── */

    fun getAnchor(): Anchor? = anchor

    /**
     * 在进入熄灯那一刻落锚。重复调用不会缩短已记录的剩余时长
     * （取两者较大值，避免一次误调用把用户的等待时间清掉）。
     */
    fun armAnchor(remainingMs: Long, startKey: String) {
        val existing = anchor
        val next = if (existing != null && existing.startKey == startKey && existing.remainingMs > remainingMs) {
            existing
        } else {
            Anchor(
                wallMs = wallClock(),
                elapsedMs = monotonicClock(),
                remainingMs = if (remainingMs > 0L) remainingMs else 0L,
                startKey = startKey,
            )
        }
        anchor = next
        persist()
    }

    /** 用当前两个时钟重新标定锚点，但保留剩余时长（重启后恢复时使用） */
    fun rebaseAnchor(remainingMs: Long, startKey: String) {
        anchor = Anchor(
            wallMs = wallClock(),
            elapsedMs = monotonicClock(),
            remainingMs = if (remainingMs > 0L) remainingMs else 0L,
            startKey = startKey,
        )
        persist()
    }

    fun clearAnchor() {
        anchor = null
        persist()
    }

    /**
     * 锚点推算出的剩余时长；已经耗尽或没有锚点时返回 null。
     *
     * 设备重启后 `elapsedRealtime` 会归零，此时退回用墙上时钟的差值估算——
     * 这是在"无法得知重启期间真实流逝时间"的前提下能做到的最好近似。
     */
    fun anchorRemainingMs(): Long? {
        val current = anchor ?: return null
        val monotonicNow = monotonicClock()
        val elapsed = if (monotonicNow >= current.elapsedMs) {
            monotonicNow - current.elapsedMs
        } else {
            val wallDelta = wallClock() - current.wallMs
            if (wallDelta > 0L) wallDelta else 0L
        }
        val remaining = current.remainingMs - elapsed
        return if (remaining > 0L) remaining else null
    }

    /* ───────────── 违规记录 ───────────── */

    fun recordTamper(direction: String, driftMs: Long) {
        tamperEvents.add(TamperEvent(wallClock(), direction, driftMs))
        while (tamperEvents.size > Constants.MAX_TAMPER_EVENTS) tamperEvents.removeAt(0)
        persist()
    }

    fun tamperEvents(): List<TamperEvent> = tamperEvents.toList()

    fun tamperCount(): Int = tamperEvents.size

    fun clearTamperEvents() {
        tamperEvents.clear()
        persist()
    }
}
