namespace Xideng.Desktop.Core;

/// <summary>场景标识（<c>packages/core/src/scene.js#SCENE</c> 的 C# 移植）。</summary>
public static class SceneKind
{
    /// <summary>假期的最后一晚——最需要提醒"明天要收心了"。</summary>
    public const string HolidayLastNight = "holiday-last-night";

    /// <summary>假期前夜——最放松、最容易熬夜的一晚。</summary>
    public const string HolidayEve = "holiday-eve";

    /// <summary>假期进行中。</summary>
    public const string Holiday = "holiday";

    /// <summary>周五晚。</summary>
    public const string FridayNight = "friday-night";

    /// <summary>周六晚。</summary>
    public const string SaturdayNight = "saturday-night";

    /// <summary>周日晚——"周一焦虑"高发时段。</summary>
    public const string SundayNight = "sunday-night";

    /// <summary>调休上班日的晚上。</summary>
    public const string MakeupWorkdayNight = "makeup-workday-night";

    /// <summary>普通工作日晚。</summary>
    public const string Ordinary = "ordinary";

    public static readonly IReadOnlyDictionary<string, string> Labels = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        [HolidayLastNight] = "假期最后一晚",
        [HolidayEve] = "假期前夜",
        [Holiday] = "假期中",
        [FridayNight] = "周五晚",
        [SaturdayNight] = "周六晚",
        [SundayNight] = "周日晚",
        [MakeupWorkdayNight] = "调休上班日晚",
        [Ordinary] = "普通工作日晚",
    };

    public static string Label(string scene) => Labels.TryGetValue(scene, out var v) ? v : scene;
}

/// <summary>"现在是怎样的一个夜晚"的结构化描述。</summary>
public sealed class SceneInfo
{
    public DateTime At { get; init; }

    public string DateKey { get; init; } = string.Empty;

    public int Hour { get; init; }

    public int Minute { get; init; }

    public int Weekday { get; init; }

    public string WeekdayName { get; init; } = string.Empty;

    public bool IsWeekend { get; init; }

    public string TimeBucket { get; init; } = string.Empty;

    public string TimeBucketLabel { get; init; } = string.Empty;

    public string? HolidayToday { get; init; }

    public string? HolidayTomorrow { get; init; }

    public string? HolidayYesterday { get; init; }

    public bool IsHolidayEve { get; init; }

    public bool IsHolidayLastNight { get; init; }

    public bool IsHolidayOngoing { get; init; }

    public bool IsMakeupWorkday { get; init; }

    public bool IsFridayNight { get; init; }

    public bool IsSaturdayNight { get; init; }

    public bool IsSundayNight { get; init; }

    public string Scene { get; init; } = SceneKind.Ordinary;

    public string SceneLabel { get; init; } = string.Empty;

    public IReadOnlyList<string> Tags { get; init; } = [];
}

/// <summary>
/// 熄灯早睡 · 场景识别（<c>packages/core/src/scene.js</c> 的 C# 移植）。
///
/// PRD 2.4 要求「识别日期属性（周五晚、周末、法定节假日）、时间节点，生成对应安抚语」。
/// 本类把"现在是怎样的一个夜晚"抽象成结构化场景，本地文案库与 AI 提示词共用同一份判定结果。
/// </summary>
public static class SceneDetector
{
    public static SceneInfo Detect(DateTime now, bool respectMakeupWorkdays = true)
    {
        var day = (int)now.DayOfWeek;
        var context = Holidays.HolidayContextOf(now);

        var holidayToday = context.Today is { IsHoliday: true } ? context.Today : null;
        var holidayTomorrow = context.Tomorrow is { IsHoliday: true } ? context.Tomorrow : null;
        var holidayYesterday = context.Yesterday is { IsHoliday: true } ? context.Yesterday : null;

        // "假期前夜"必须是"今天还在上班、明天开始放假"；
        // 若今天本身已在假期中（如 10-02，明天 10-03 也是假期），则不算前夜。
        var isHolidayEve = holidayToday is null && holidayTomorrow is not null;
        var isHolidayLastNight = holidayToday is not null && holidayTomorrow is null;
        var isHolidayOngoing = holidayToday is not null && !isHolidayLastNight;
        var isMakeup = respectMakeupWorkdays && Holidays.IsMakeupWorkday(now);

        var isFridayNight = day == 5;
        var isSaturdayNight = day == 6;
        var isSundayNight = day == 0;

        var primary = SceneKind.Ordinary;
        if (isHolidayLastNight)
        {
            primary = SceneKind.HolidayLastNight;
        }
        else if (isHolidayEve)
        {
            primary = SceneKind.HolidayEve;
        }
        else if (isHolidayOngoing)
        {
            primary = SceneKind.Holiday;
        }
        else if (isMakeup)
        {
            // ⚠️ 与 Web 端 packages/core/src/scene.js 的**有意分歧**（已记录在 README）：
            // 调休上班日按定义必然是周六或周日，而 JS 把 isSaturdayNight / isSundayNight
            // 排在 isMakeup 之前，导致 SCENE.MAKEUP_WORKDAY_NIGHT 与文案 mw-1 永远不可达。
            // 本桌面端把调休日判定提前（仍在节假日判定之后），使其名副其实地生效。
            // 对 2026 年的 6 个调休日而言，此改动只会把"周六晚/周日晚"改判为"调休上班日晚"，
            // 不影响周五晚、周六晚、周日晚与节假日场景在普通日期上的判定结果。
            primary = SceneKind.MakeupWorkdayNight;
        }
        else if (isFridayNight)
        {
            primary = SceneKind.FridayNight;
        }
        else if (isSaturdayNight)
        {
            primary = SceneKind.SaturdayNight;
        }
        else if (isSundayNight)
        {
            primary = SceneKind.SundayNight;
        }

        var tags = new List<string> { primary };
        if (TimeUtil.IsWeekend(now))
        {
            tags.Add("weekend");
        }

        if (isMakeup)
        {
            tags.Add("makeup-workday");
        }

        if (holidayToday is not null)
        {
            tags.Add($"holiday:{holidayToday.Name}");
        }

        if (isHolidayEve && holidayTomorrow is not null)
        {
            tags.Add($"holiday-eve:{holidayTomorrow.Name}");
        }

        if (day is 5 or 6)
        {
            tags.Add("can-sleep-in");
        }

        var bucket = TimeUtil.TimeBucketOf(now);

        return new SceneInfo
        {
            At = now,
            DateKey = TimeUtil.DateKey(now),
            Hour = now.Hour,
            Minute = now.Minute,
            Weekday = day,
            WeekdayName = TimeUtil.WeekdayName(now),
            IsWeekend = TimeUtil.IsWeekend(now),
            TimeBucket = bucket,
            TimeBucketLabel = TimeUtil.TimeBucketLabel(bucket),
            HolidayToday = holidayToday?.Name,
            HolidayTomorrow = holidayTomorrow?.Name,
            HolidayYesterday = holidayYesterday?.Name,
            IsHolidayEve = isHolidayEve,
            IsHolidayLastNight = isHolidayLastNight,
            IsHolidayOngoing = isHolidayOngoing,
            IsMakeupWorkday = isMakeup,
            IsFridayNight = isFridayNight,
            IsSaturdayNight = isSaturdayNight,
            IsSundayNight = isSundayNight,
            Scene = primary,
            SceneLabel = SceneKind.Label(primary),
            Tags = tags,
        };
    }

    /// <summary>
    /// 把场景压成一句给 AI 的中文描述，作为提示词的事实依据。
    /// 刻意只提供结构化事实，不提供自由文本，以降低模型编造日期与数据的空间。
    /// </summary>
    public static string Describe(SceneInfo scene)
    {
        var parts = new List<string>
        {
            $"现在是 {scene.DateKey} {scene.WeekdayName} {scene.Hour:00}:{scene.Minute:00}",
            $"场景类型：{scene.SceneLabel}",
            $"时段：{scene.TimeBucketLabel}",
        };

        if (scene.HolidayToday is not null)
        {
            parts.Add($"今天是{scene.HolidayToday}假期中");
        }

        if (scene.HolidayTomorrow is not null)
        {
            parts.Add($"明天是{scene.HolidayTomorrow}假期第一天");
        }

        if (scene.IsHolidayLastNight)
        {
            parts.Add($"今天是{scene.HolidayToday}假期的最后一天，明天要恢复正常作息");
        }

        if (scene.IsMakeupWorkday)
        {
            parts.Add("今天为法定调休上班日");
        }

        return string.Join("；", parts);
    }
}
