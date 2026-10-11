package com.xideng.sleep.core

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

/**
 * 熄灯早睡 · 时间与日期基础工具
 *
 * 与 `packages/core/src/time.js` 语义一致。所有函数都是纯函数，
 * **从不读取系统当前时间**——当前时间一律由调用方注入，
 * 这样熄灯判定才能在单元测试里被完整地"穿越时间"验证。
 */
object TimeUtils {

    const val MINUTES_PER_DAY = 1440
    const val MS_MINUTE = 60_000L
    const val MS_HOUR = 3_600_000L
    const val MS_DAY = 86_400_000L

    /** 与 JavaScript `Date#getDay()` 对齐：0 = 周日 … 6 = 周六 */
    val WEEKDAY_NAMES = arrayOf("周日", "周一", "周二", "周三", "周四", "周五", "周六")

    val TIME_BUCKET_LABELS: Map<String, String> = mapOf(
        "late" to "刚躺下",
        "midnight" to "深夜",
        "smallHours" to "后半夜",
        "dawn" to "天将亮",
        "morning" to "上午",
        "afternoon" to "下午",
        "evening" to "傍晚",
    )

    fun zone(): ZoneId = ZoneId.systemDefault()

    fun pad2(value: Int): String = if (value < 10) "0" + value else value.toString()

    /**
     * `"23:00"` → `1380`（自当日 00:00 起的分钟数）。
     * @throws IllegalArgumentException 格式非法或超出取值范围时抛出，避免脏数据静默进入熄灯判定。
     */
    fun toMinutes(hhmm: String?): Int {
        val text = (hhmm ?: "").trim()
        val matched = HHMM.matchEntire(text)
            ?: throw IllegalArgumentException("时间格式非法，应为 HH:MM，收到：" + hhmm)
        val hours = matched.groupValues[1].toInt()
        val minutes = matched.groupValues[2].toInt()
        if (hours > 23 || minutes > 59) throw IllegalArgumentException("时间超出范围：$hhmm")
        return hours * 60 + minutes
    }

    /** `1380` → `"23:00"`，自动按一天取模 */
    fun fromMinutes(totalMinutes: Int): String {
        val normalized = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
        return pad2(normalized / 60) + ":" + pad2(normalized % 60)
    }

    /** 与 JS `Date#getDay()` 对齐的星期序号 */
    fun jsWeekday(date: LocalDate): Int = date.dayOfWeek.value % 7

    fun isWeekend(date: LocalDate): Boolean =
        date.dayOfWeek == DayOfWeek.SATURDAY || date.dayOfWeek == DayOfWeek.SUNDAY

    fun weekdayName(date: LocalDate): String = WEEKDAY_NAMES[jsWeekday(date)]

    /** `2026-01-01`（本地时区日历日） */
    fun dateKey(date: LocalDate): String =
        date.year.toString() + "-" + pad2(date.monthValue) + "-" + pad2(date.dayOfMonth)

    /** `"2026-01-01"` → LocalDate */
    fun parseDateKey(key: String?): LocalDate {
        val text = (key ?: "").trim()
        val matched = DATE_KEY.matchEntire(text)
            ?: throw IllegalArgumentException("日期格式非法，应为 YYYY-MM-DD，收到：" + key)
        return LocalDate.of(
            matched.groupValues[1].toInt(),
            matched.groupValues[2].toInt(),
            matched.groupValues[3].toInt(),
        )
    }

    fun localDate(instant: Instant): LocalDate = instant.atZone(zone()).toLocalDate()

    fun localDateTime(instant: Instant): LocalDateTime = instant.atZone(zone()).toLocalDateTime()

    /** 当日 00:00:00（本地时区）对应的 Instant */
    fun startOfDayInstant(date: LocalDate): Instant = date.atStartOfDay(zone()).toInstant()

    /** 相隔的日历天数（b - a） */
    fun daysBetween(a: LocalDate, b: LocalDate): Long =
        b.toEpochDay() - a.toEpochDay()

    /**
     * `"23:04"`；`seconds = true` 时输出 `"23:04:15"`。
     * 黑屏界面每帧都会调用，因此刻意不做字符串格式化以外的分配。
     */
    fun formatClock(time: LocalDateTime, seconds: Boolean = false): String {
        val clock = pad2(time.hour) + ":" + pad2(time.minute)
        return if (seconds) clock + ":" + pad2(time.second) else clock
    }

    /**
     * 把毫秒时长渲染成中文口语表达，用于"距离本次熄灯结束"。
     * 例：`6h23m` → `"6 小时 23 分"`；`23m12s` → `"23 分 12 秒"`；`<60s` → `"不足 1 分钟"`
     */
    fun formatDurationCN(ms: Long): String {
        val total = (if (ms < 0L) 0L else ms) / 1000L
        val hours = total / 3600L
        val minutes = (total % 3600L) / 60L
        val seconds = total % 60L
        return when {
            hours > 0L -> if (minutes > 0L) "$hours 小时 $minutes 分" else "$hours 小时"
            minutes > 0L -> if (seconds > 0L) "$minutes 分 $seconds 秒" else "$minutes 分"
            else -> "不足 1 分钟"
        }
    }

    /** 倒计时专用：始终带秒，且不足 1 分钟时显示秒数（预告弹窗需要精确读秒）。 */
    fun formatCountdownCN(ms: Long): String {
        val total = (if (ms < 0) 0L else ms) / 1000L
        val hours = total / 3600L
        val minutes = (total % 3600L) / 60L
        val seconds = total % 60L
        return when {
            hours > 0L -> "$hours 小时 $minutes 分"
            minutes > 0L -> "$minutes 分 $seconds 秒"
            else -> "$seconds 秒"
        }
    }

    /** 一天中的时段分区，供 AI 文案与本地文案挑选合适的语气 */
    fun timeBucketOf(time: LocalDateTime): String {
        val hour = time.hour
        return when {
            hour >= 22 -> "late"          // 22:00 - 23:59 刚躺下
            hour < 3 -> "midnight"        // 00:00 - 02:59 深夜
            hour < 5 -> "smallHours"      // 03:00 - 04:59 后半夜
            hour < 7 -> "dawn"            // 05:00 - 06:59 天将亮
            hour < 12 -> "morning"
            hour < 18 -> "afternoon"
            else -> "evening"
        }
    }

    private val HHMM = Regex("(\\d{1,2}):(\\d{2})")
    private val DATE_KEY = Regex("(\\d{4})-(\\d{2})-(\\d{2})")
}
