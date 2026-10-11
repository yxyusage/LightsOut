package com.xideng.sleep.util

/**
 * 熄灯早睡 · 连续点击计数器（PRD 2.2.5：连续点击屏幕 5 次触发紧急解除）
 *
 * 超出时间窗则重新计数，避免用户零散点击意外触发。
 * 与 `packages/core/src/guard.js` 的 `createTapCounter` 语义一致。
 */
class TapCounter(
    private val required: Int = 5,
    private val windowMs: Long = 3_000L,
) {

    data class Result(val triggered: Boolean, val progress: Int, val remaining: Int)

    private val timestamps = ArrayDeque<Long>()

    val progress: Int
        get() = timestamps.size

    fun tap(now: Long = System.currentTimeMillis()): Result {
        while (timestamps.isNotEmpty() && now - timestamps.first() > windowMs) {
            timestamps.removeFirst()
        }
        timestamps.addLast(now)

        if (timestamps.size >= required) {
            timestamps.clear()
            return Result(true, 0, required)
        }
        return Result(false, timestamps.size, required - timestamps.size)
    }

    fun reset() {
        timestamps.clear()
    }
}
