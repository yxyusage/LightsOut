package com.xideng.sleep.lock

import android.os.SystemClock
import com.xideng.sleep.core.Constants
import kotlin.math.abs

/**
 * 熄灯早睡 · 系统时间篡改检测（PRD 三）
 *
 * 用单调时钟（[SystemClock.elapsedRealtime]，包含深睡、不受改时间影响）作为参照，
 * 若"墙上时钟的增量"与"单调时钟的增量"出现明显偏差，说明用户改了系统时间。
 *
 * 与 `packages/core/src/guard.js` 的 `createClockGuard` 语义一致。
 * 注意这里只负责**检测**；"不重置剩余时长"由 [com.xideng.sleep.core.GuardStore] 的锚点保证。
 */
class ClockGuard(
    private val wallClock: () -> Long = { System.currentTimeMillis() },
    private val monotonicClock: () -> Long = { SystemClock.elapsedRealtime() },
    private val toleranceMs: Long = Constants.CLOCK_TAMPER_TOLERANCE_MS,
) {

    data class Jump(
        val driftMs: Long,
        /** "forward" 向前拨（可能想跳过熄灯时段）；"backward" 向后拨 */
        val direction: String,
        val wallMs: Long,
    )

    private var lastWall: Long = wallClock()
    private var lastMonotonic: Long = monotonicClock()

    /** 取一次样本；没有异常返回 null */
    fun sample(): Jump? {
        val wall = wallClock()
        val monotonic = monotonicClock()
        val drift = (wall - lastWall) - (monotonic - lastMonotonic)
        lastWall = wall
        lastMonotonic = monotonic

        if (abs(drift) <= toleranceMs) return null
        return Jump(
            driftMs = drift,
            direction = if (drift > 0L) "forward" else "backward",
            wallMs = wall,
        )
    }

    fun reset() {
        lastWall = wallClock()
        lastMonotonic = monotonicClock()
    }
}
