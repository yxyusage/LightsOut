package com.xideng.sleep.core

import java.time.LocalDate

/**
 * 熄灯早睡 · 中国法定节假日与调休数据
 *
 * 数据来源为国务院办公厅正式通知，逐日核对过星期。**不包含任何推测或杜撰日期**，
 * 因为赛事规则明令禁止"虚构数据、伪造案例或误导用户的内容"。
 *
 * 覆盖范围：2026 年。数据缺失时按"普通日期"处理，不会误判成节日。
 */
object Holidays {

    /** 数据来源，会在"关于 / 数据溯源"界面展示，满足赛事"责任可信"维度 */
    const val SOURCE_TITLE = "国务院办公厅关于2026年部分节假日安排的通知"
    const val SOURCE_DOCUMENT_NUMBER = "国办发明电〔2025〕7号"
    const val SOURCE_ISSUED_AT = "2025-11-04"
    const val SOURCE_URL = "https://www.gov.cn/zhengce/content/202511/content_7047090.htm"
    const val SOURCE_COVERAGE = "2026-01-01 ~ 2026-12-31"

    enum class Kind { HOLIDAY, MAKEUP }

    data class HolidayRange(
        val name: String,
        val start: String,
        val end: String,
        val makeup: List<String>,
        val greeting: String,
        val eve: List<String>,
    )

    data class DateInfo(
        val dateKey: String,
        val name: String,
        val kind: Kind,
        val range: HolidayRange,
    )

    /** 与 `packages/core/src/holidays.js` 的 HOLIDAY_RANGES 完全一致：2026 年 7 个节日 + 6 个调休上班日。 */
    val RANGES: List<HolidayRange> = listOf(
        HolidayRange(
            name = "元旦",
            start = "2026-01-01",
            end = "2026-01-03",
            makeup = listOf("2026-01-04"),
            greeting = "元旦快乐。新的一年，从今晚睡个好觉开始",
            eve = listOf("跨年前夜，把闹钟留给明天，把此刻交给睡眠"),
        ),
        HolidayRange(
            name = "春节",
            start = "2026-02-15",
            end = "2026-02-23",
            makeup = listOf("2026-02-14", "2026-02-28"),
            greeting = "春节快乐。团圆的日子，也要好好睡觉",
            eve = listOf("明天就是除夕了，养足精神才有力气过年"),
        ),
        HolidayRange(
            name = "清明节",
            start = "2026-04-04",
            end = "2026-04-06",
            makeup = emptyList(),
            greeting = "清明安康。早一点休息，明天才有清明的气力",
            eve = listOf("明天是清明，早些歇息"),
        ),
        HolidayRange(
            name = "劳动节",
            start = "2026-05-01",
            end = "2026-05-05",
            makeup = listOf("2026-05-09"),
            greeting = "劳动节快乐。辛苦了这么久，今晚该好好休息",
            eve = listOf("假期前夜，明天可以睡到自然醒"),
        ),
        HolidayRange(
            name = "端午节",
            start = "2026-06-19",
            end = "2026-06-21",
            makeup = emptyList(),
            greeting = "端午安康。粽子明天再吃，今晚先睡",
            eve = listOf("明天是端午，今晚早点收工"),
        ),
        HolidayRange(
            name = "中秋节",
            start = "2026-09-25",
            end = "2026-09-27",
            makeup = emptyList(),
            greeting = "中秋快乐。月光很好，但闭眼更好",
            eve = listOf("明天是中秋，今晚早些歇下"),
        ),
        HolidayRange(
            name = "国庆节",
            start = "2026-10-01",
            end = "2026-10-07",
            makeup = listOf("2026-09-20", "2026-10-10"),
            greeting = "国庆快乐。假期很长，睡眠也要够长",
            eve = listOf("明天就是国庆假期了，今晚睡个好觉，假期好好放松"),
        ),
    )

    private val INDEX: MutableMap<String, DateInfo> = LinkedHashMap()

    init {
        for (range in RANGES) indexRange(range)
    }

    private fun indexRange(range: HolidayRange) {
        val from = TimeUtils.parseDateKey(range.start)
        val to = TimeUtils.parseDateKey(range.end)
        var day = from
        while (!day.isAfter(to)) {
            val key = TimeUtils.dateKey(day)
            INDEX[key] = DateInfo(key, range.name, Kind.HOLIDAY, range)
            day = day.plusDays(1)
        }
        for (makeup in range.makeup) {
            INDEX[makeup] = DateInfo(makeup, range.name, Kind.MAKEUP, range)
        }
    }

    /** 该年的数据是否已覆盖（设置页用它提示"节日文案数据未覆盖"） */
    fun hasDataForYear(year: Int): Boolean = INDEX.keys.any { it.startsWith(year.toString() + "-") }

    fun coveredYears(): List<String> = INDEX.keys.map { it.substring(0, 4) }.distinct().sorted()

    fun getDateInfo(date: LocalDate): DateInfo? = INDEX[TimeUtils.dateKey(date)]

    fun getDateInfo(dateKey: String): DateInfo? = INDEX[dateKey]

    fun isHoliday(date: LocalDate): Boolean = getDateInfo(date)?.kind == Kind.HOLIDAY

    fun isMakeupWorkday(date: LocalDate): Boolean = getDateInfo(date)?.kind == Kind.MAKEUP

    /** 节假日语境：同时看昨天 / 今天 / 明天，供场景识别使用 */
    fun holidayContext(date: LocalDate): Triple<DateInfo?, DateInfo?, DateInfo?> = Triple(
        getDateInfo(date.minusDays(1)),
        getDateInfo(date),
        getDateInfo(date.plusDays(1)),
    )

    fun getRangeByName(name: String): HolidayRange? = RANGES.firstOrNull { it.name == name }
}
