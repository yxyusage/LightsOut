package com.xideng.sleep.core

import java.time.LocalDateTime

/**
 * 熄灯早睡 · 场景识别
 *
 * PRD 2.4 要求「识别日期属性（周五晚、周末、法定节假日）、时间节点，生成对应安抚语」。
 * 本模块把"现在是怎样的一个夜晚"抽象成结构化场景对象，本地文案库与 AI 提示词
 * 共用同一份判定结果，保证两条路径的语气与事实完全一致。
 */

object SceneId {
    /** 假期的最后一晚——最需要提醒"明天要收心了" */
    const val HOLIDAY_LAST_NIGHT = "holiday-last-night"

    /** 假期前夜——最放松、最容易熬夜的一晚 */
    const val HOLIDAY_EVE = "holiday-eve"

    /** 假期进行中 */
    const val HOLIDAY = "holiday"

    const val FRIDAY_NIGHT = "friday-night"
    const val SATURDAY_NIGHT = "saturday-night"
    const val SUNDAY_NIGHT = "sunday-night"
    const val MAKEUP_WORKDAY_NIGHT = "makeup-workday-night"
    const val ORDINARY = "ordinary"

    val LABELS: Map<String, String> = mapOf(
        HOLIDAY_LAST_NIGHT to "假期最后一晚",
        HOLIDAY_EVE to "假期前夜",
        HOLIDAY to "假期中",
        FRIDAY_NIGHT to "周五晚",
        SATURDAY_NIGHT to "周六晚",
        SUNDAY_NIGHT to "周日晚",
        MAKEUP_WORKDAY_NIGHT to "调休上班日晚",
        ORDINARY to "普通工作日晚",
    )
}

data class SceneInfo(
    val dateKey: String,
    val hour: Int,
    val minute: Int,
    val weekday: Int,
    val weekdayName: String,
    val isWeekend: Boolean,
    val timeBucket: String,
    val timeBucketLabel: String,
    val holidayToday: String?,
    val holidayTomorrow: String?,
    val holidayYesterday: String?,
    val isHolidayEve: Boolean,
    val isHolidayLastNight: Boolean,
    val isHolidayOngoing: Boolean,
    val isMakeupWorkday: Boolean,
    val isFridayNight: Boolean,
    val isSaturdayNight: Boolean,
    val isSundayNight: Boolean,
    /** 主场景标识，见 [SceneId] */
    val scene: String,
    val sceneLabel: String,
    val tags: List<String>,
)

object SceneDetector {

    fun detect(now: LocalDateTime, respectMakeupWorkdays: Boolean = true): SceneInfo {
        val date = now.toLocalDate()
        val weekday = TimeUtils.jsWeekday(date)
        val context = Holidays.holidayContext(date)
        val yesterdayInfo = context.first
        val todayInfo = context.second
        val tomorrowInfo = context.third

        val holidayToday = if (todayInfo?.kind == Holidays.Kind.HOLIDAY) todayInfo else null
        val holidayTomorrow = if (tomorrowInfo?.kind == Holidays.Kind.HOLIDAY) tomorrowInfo else null
        val holidayYesterday = if (yesterdayInfo?.kind == Holidays.Kind.HOLIDAY) yesterdayInfo else null

        // "假期前夜"必须是"今天还在上班、明天开始放假"；
        // 若今天本身已在假期中（如 10-02，明天 10-03 也是假期），则不算前夜。
        val isHolidayEve = holidayToday == null && holidayTomorrow != null
        val isHolidayLastNight = holidayToday != null && holidayTomorrow == null
        val isHolidayOngoing = holidayToday != null && !isHolidayLastNight
        val isMakeup = respectMakeupWorkdays && Holidays.isMakeupWorkday(date)

        val isFridayNight = weekday == 5
        val isSaturdayNight = weekday == 6
        val isSundayNight = weekday == 0

        var primary = SceneId.ORDINARY
        if (isHolidayLastNight) primary = SceneId.HOLIDAY_LAST_NIGHT
        else if (isHolidayEve) primary = SceneId.HOLIDAY_EVE
        else if (isHolidayOngoing) primary = SceneId.HOLIDAY
        else if (isFridayNight) primary = SceneId.FRIDAY_NIGHT
        else if (isSaturdayNight) primary = SceneId.SATURDAY_NIGHT
        else if (isSundayNight) primary = SceneId.SUNDAY_NIGHT
        else if (isMakeup) primary = SceneId.MAKEUP_WORKDAY_NIGHT

        val tags = mutableListOf(primary)
        if (TimeUtils.isWeekend(date)) tags.add("weekend")
        if (isMakeup) tags.add("makeup-workday")
        if (holidayToday != null) tags.add("holiday:" + holidayToday.name)
        if (isHolidayEve && holidayTomorrow != null) tags.add("holiday-eve:" + holidayTomorrow.name)
        if (weekday == 5 || weekday == 6) tags.add("can-sleep-in")

        val timeBucket = TimeUtils.timeBucketOf(now)

        return SceneInfo(
            dateKey = TimeUtils.dateKey(date),
            hour = now.hour,
            minute = now.minute,
            weekday = weekday,
            weekdayName = TimeUtils.weekdayName(date),
            isWeekend = TimeUtils.isWeekend(date),
            timeBucket = timeBucket,
            timeBucketLabel = TimeUtils.TIME_BUCKET_LABELS[timeBucket] ?: "",
            holidayToday = holidayToday?.name,
            holidayTomorrow = holidayTomorrow?.name,
            holidayYesterday = holidayYesterday?.name,
            isHolidayEve = isHolidayEve,
            isHolidayLastNight = isHolidayLastNight,
            isHolidayOngoing = isHolidayOngoing,
            isMakeupWorkday = isMakeup,
            isFridayNight = isFridayNight,
            isSaturdayNight = isSaturdayNight,
            isSundayNight = isSundayNight,
            scene = primary,
            sceneLabel = SceneId.LABELS[primary] ?: "",
            tags = tags,
        )
    }

    /**
     * 把场景压成一句给 AI 的中文描述，作为提示词的事实依据。
     * 刻意只提供结构化事实，不提供自由文本，以降低模型编造日期与数据的空间。
     */
    fun describe(scene: SceneInfo): String {
        val parts = mutableListOf<String>()
        parts.add(
            "现在是 " + scene.dateKey + " " + scene.weekdayName + " " +
                TimeUtils.pad2(scene.hour) + ":" + TimeUtils.pad2(scene.minute),
        )
        parts.add("场景类型：" + scene.sceneLabel)
        parts.add("时段：" + scene.timeBucketLabel)
        scene.holidayToday?.let { parts.add("今天是" + it + "假期中") }
        scene.holidayTomorrow?.let { parts.add("明天是" + it + "假期第一天") }
        if (scene.isHolidayLastNight && scene.holidayToday != null) {
            parts.add("今天是" + scene.holidayToday + "假期的最后一天，明天要恢复正常作息")
        }
        if (scene.isMakeupWorkday) parts.add("今天为法定调休上班日")
        return parts.joinToString("；")
    }
}
