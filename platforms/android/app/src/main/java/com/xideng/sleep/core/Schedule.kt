package com.xideng.sleep.core

import java.time.Instant
import java.time.LocalDate

/**
 * 熄灯早睡 · 睡眠计划与相位判定
 *
 * 这是 PRD 2.1「睡眠计划管理」与 2.2.1「进入触发逻辑」的纯逻辑实现。
 * 关键点：熄灯时段支持跨天（23:00 → 次日 07:00），所以判定"此刻是否在熄灯中"
 * 必须同时检查"今天开启的时段"和"昨天开启的时段"。
 *
 * 与 `packages/core/src/schedule.js` 逐函数对应，两端判定结果必须完全一致。
 */

data class SleepWindow(
    val start: Instant,
    val end: Instant,
    val dayType: DayType,
    val crossesMidnight: Boolean,
    /** 区间"开始日"的 YYYY-MM-DD，用作紧急解除与额度周期的键 */
    val startKey: String,
    val durationMs: Long,
)

data class PhaseResult(
    val phase: Phase,
    val window: SleepWindow?,
    val remainingMs: Long,
    val warnMs: Long,
    val dismissed: Boolean,
)

object Schedule {

    /**
     * 判定某一天按哪套时段执行。
     *
     * 相比 PRD 的"工作日/周末"二分，这里多加了一层**调休上班日**处理：
     * 法定调休把某个周六变成上班日，用户当天仍在上班，晚上理应按工作日时段熄灯。
     * 若希望严格照搬 PRD 字面语义，把 respectMakeupWorkdays 设为 false 即可。
     */
    fun dayTypeOf(date: LocalDate, respectMakeupWorkdays: Boolean = true): DayType {
        if (respectMakeupWorkdays && Holidays.isMakeupWorkday(date)) return DayType.WEEKDAY
        return if (TimeUtils.isWeekend(date)) DayType.WEEKEND else DayType.WEEKDAY
    }

    /** 构造"以某一天为起点"的熄灯区间。date 是区间**开始**的那一天。 */
    fun windowForDate(
        plan: PlanSettings?,
        date: LocalDate,
        respectMakeupWorkdays: Boolean = true,
    ): SleepWindow? {
        if (plan == null) return null
        val dayType = dayTypeOf(date, respectMakeupWorkdays)
        val config = plan.windows[dayType] ?: return null

        val startMinutes: Int
        val endMinutes: Int
        try {
            startMinutes = TimeUtils.toMinutes(config.start)
            endMinutes = TimeUtils.toMinutes(config.end)
        } catch (error: IllegalArgumentException) {
            // 脏数据不应让熄灯判定崩溃；按"当日未配置"处理
            return null
        }
        // start == end 视为未配置（既非 0 分钟也非 24 小时，语义含糊），交由 UI 校验提示
        if (startMinutes == endMinutes) return null

        val crossesMidnight = endMinutes < startMinutes
        val dayStart = date.atStartOfDay(TimeUtils.zone())
        val start = dayStart.plusMinutes(startMinutes.toLong()).toInstant()
        val endMinutesFromDayStart =
            if (crossesMidnight) endMinutes + TimeUtils.MINUTES_PER_DAY else endMinutes
        val end = dayStart.plusMinutes(endMinutesFromDayStart.toLong()).toInstant()

        return SleepWindow(
            start = start,
            end = end,
            dayType = dayType,
            crossesMidnight = crossesMidnight,
            startKey = TimeUtils.dateKey(date),
            durationMs = end.toEpochMilli() - start.toEpochMilli(),
        )
    }

    /** 此刻是否处于熄灯时段内；是则返回该区间。只需检查偏移 0 与 -1 天：单次时段必然短于 24 小时。 */
    fun activeWindowAt(
        plan: PlanSettings?,
        now: Instant,
        respectMakeupWorkdays: Boolean = true,
    ): SleepWindow? {
        if (plan == null || !plan.enabled) return null
        val today = TimeUtils.localDate(now)
        for (offset in OFFSETS_BACKWARD) {
            val window = windowForDate(plan, today.plusDays(offset), respectMakeupWorkdays) ?: continue
            if (!now.isBefore(window.start) && now.isBefore(window.end)) return window
        }
        return null
    }

    /** 此刻之后最早开始的熄灯区间 */
    fun nextWindowAt(
        plan: PlanSettings?,
        now: Instant,
        respectMakeupWorkdays: Boolean = true,
    ): SleepWindow? {
        if (plan == null || !plan.enabled) return null
        val today = TimeUtils.localDate(now)
        var earliest: SleepWindow? = null
        for (offset in OFFSETS_FORWARD) {
            val window = windowForDate(plan, today.plusDays(offset), respectMakeupWorkdays) ?: continue
            if (!window.start.isAfter(now)) continue
            val current = earliest
            if (current == null || window.start.isBefore(current.start)) earliest = window
        }
        return earliest
    }

    /**
     * 求此刻的引擎相位。这是整个应用唯一的时间判定入口。
     *
     * [dismissedWindowKey] 为被紧急解除的时段开始日；解除只作用于"当前这一次"时段，
     * 次日计划照常生效（PRD 2.2.5）。
     */
    fun phaseAt(
        plan: PlanSettings?,
        now: Instant,
        warnMinutes: Int = plan?.warnMinutes ?: 0,
        dismissedWindowKey: String? = null,
        respectMakeupWorkdays: Boolean = true,
    ): PhaseResult {
        if (plan == null || !plan.enabled) {
            return PhaseResult(Phase.OFF, null, 0L, 0L, false)
        }

        val active = activeWindowAt(plan, now, respectMakeupWorkdays)
        if (active != null) {
            val dismissed = dismissedWindowKey != null && dismissedWindowKey == active.startKey
            val rawRemaining = active.end.toEpochMilli() - now.toEpochMilli()
            return PhaseResult(
                phase = if (dismissed) Phase.OFF else Phase.ACTIVE,
                window = active,
                remainingMs = if (rawRemaining > 0L) rawRemaining else 0L,
                warnMs = 0L,
                dismissed = dismissed,
            )
        }

        val next = nextWindowAt(plan, now, respectMakeupWorkdays)
            ?: return PhaseResult(Phase.IDLE, null, 0L, 0L, false)

        val untilStartMs = next.start.toEpochMilli() - now.toEpochMilli()
        val warnMs = (if (warnMinutes > 0) warnMinutes else 0).toLong() * TimeUtils.MS_MINUTE
        val inWarning = warnMs > 0L && untilStartMs <= warnMs

        return PhaseResult(
            phase = if (inWarning) Phase.WARNING else Phase.IDLE,
            window = next,
            remainingMs = untilStartMs,
            warnMs = warnMs,
            dismissed = false,
        )
    }

    /**
     * 从"当前相位"出发，算出下一个需要唤醒的时刻（毫秒时间戳）。
     * 供 AlarmManager 精确调度与前台服务的自适应心跳使用。
     */
    fun nextBoundaryAt(plan: PlanSettings?, now: Instant): Long? {
        if (plan == null || !plan.enabled) return null
        val active = activeWindowAt(plan, now)
        if (active != null) return active.end.toEpochMilli()
        val next = nextWindowAt(plan, now) ?: return null
        val warnMs = (if (plan.warnMinutes > 0) plan.warnMinutes else 0).toLong() * TimeUtils.MS_MINUTE
        val warnStart = next.start.toEpochMilli() - warnMs
        return if (warnMs > 0L && warnStart > now.toEpochMilli()) warnStart else next.start.toEpochMilli()
    }

    /** 校验一套时段配置，返回人类可读的问题列表（空列表表示合法）。UI 在用户编辑时实时调用。 */
    fun validateWindow(start: String?, end: String?): List<String> {
        val problems = mutableListOf<String>()
        var startMinutes: Int? = null
        var endMinutes: Int? = null

        try {
            startMinutes = TimeUtils.toMinutes(start)
        } catch (error: IllegalArgumentException) {
            problems.add("开始时间格式应为 HH:MM")
        }
        try {
            endMinutes = TimeUtils.toMinutes(end)
        } catch (error: IllegalArgumentException) {
            problems.add("结束时间格式应为 HH:MM")
        }
        if (problems.isNotEmpty()) return problems

        val startValue = startMinutes ?: return problems
        val endValue = endMinutes ?: return problems
        if (startValue == endValue) {
            problems.add("开始时间与结束时间不能相同")
            return problems
        }

        val durationMinutes =
            ((endValue - startValue) + TimeUtils.MINUTES_PER_DAY) % TimeUtils.MINUTES_PER_DAY
        if (durationMinutes < 30) problems.add("熄灯时段不应短于 30 分钟")
        if (durationMinutes > 16 * 60) problems.add("熄灯时段不宜长于 16 小时")

        return problems
    }

    private val OFFSETS_BACKWARD = longArrayOf(0L, -1L)
    private val OFFSETS_FORWARD = longArrayOf(0L, 1L, 2L)
}
