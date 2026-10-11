namespace Xideng.Desktop.Core;

/// <summary>数据来源元信息，会在"关于 / 数据溯源"界面展示（赛事"责任可信"维度）。</summary>
public sealed class HolidayTableSource
{
    public string Title { get; init; } = "国务院办公厅关于2026年部分节假日安排的通知";

    public string DocumentNumber { get; init; } = "国办发明电〔2025〕7号";

    public string IssuedAt { get; init; } = "2025-11-04";

    public string Url { get; init; } = "https://www.gov.cn/zhengce/content/202511/content_7047090.htm";

    public string Coverage { get; init; } = "2026-01-01 ~ 2026-12-31";

    public string Note { get; init; } =
        "本表仅覆盖 2026 年。其他年份数据缺失时按普通日期处理，不会产生错误的节日文案。";
}

/// <summary>一个法定节假日的放假区间与调休安排。</summary>
public sealed class HolidayRange
{
    public required string Name { get; init; }

    public required string Start { get; init; }

    public required string End { get; init; }

    /// <summary>调休上班日（周末但需上班）。</summary>
    public required string[] Makeup { get; init; }

    public required string Greeting { get; init; }

    /// <summary>节前夜专属安抚语句。</summary>
    public string[] Eve { get; init; } = [];
}

/// <summary>某一天的节假日属性。</summary>
public sealed record DateInfo(string DateKey, string Name, string Kind, HolidayRange Range)
{
    public const string KindHoliday = "holiday";
    public const string KindMakeup = "makeup";

    public bool IsHoliday => Kind == KindHoliday;

    public bool IsMakeup => Kind == KindMakeup;
}

/// <summary>节假日语境：同时看昨天 / 今天 / 明天，供场景识别使用。</summary>
public sealed record HolidayContext(DateInfo? Yesterday, DateInfo? Today, DateInfo? Tomorrow);

/// <summary>
/// 熄灯早睡 · 中国法定节假日与调休数据（<c>packages/core/src/holidays.js</c> 的 C# 移植）。
///
/// 数据来源为国务院办公厅正式通知，逐日核对过星期。<b>不包含任何推测或杜撰日期</b>，
/// 因为赛事规则明令禁止"虚构数据、伪造案例或误导用户的内容"。
///
/// 与 JS 版的一致性由 <c>--selftest</c> 保证：自检会把 20 个官方日期与它们在通知中
/// 写明的星期逐一比对（见 <see cref="OfficialWeekdays"/>），这是防止"抄错一天"最有效的防线。
/// </summary>
public static class Holidays
{
    public static readonly HolidayTableSource Source = new();

    /// <summary>
    /// 2026 年 7 个节日的放假区间与 6 个调休上班日。
    /// 顺序与 JS 版 <c>HOLIDAY_RANGES</c> 完全一致。
    /// </summary>
    public static readonly IReadOnlyList<HolidayRange> Ranges =
    [
        new HolidayRange
        {
            Name = "元旦",
            Start = "2026-01-01",
            End = "2026-01-03",
            Makeup = ["2026-01-04"],
            Greeting = "元旦快乐。新的一年，从今晚睡个好觉开始",
            Eve = ["跨年前夜，把闹钟留给明天，把此刻交给睡眠"],
        },
        new HolidayRange
        {
            Name = "春节",
            Start = "2026-02-15",
            End = "2026-02-23",
            Makeup = ["2026-02-14", "2026-02-28"],
            Greeting = "春节快乐。团圆的日子，也要好好睡觉",
            Eve = ["明天就是除夕了，养足精神才有力气过年"],
        },
        new HolidayRange
        {
            Name = "清明节",
            Start = "2026-04-04",
            End = "2026-04-06",
            Makeup = [],
            Greeting = "清明安康。早一点休息，明天才有清明的气力",
            Eve = ["明天是清明，早些歇息"],
        },
        new HolidayRange
        {
            Name = "劳动节",
            Start = "2026-05-01",
            End = "2026-05-05",
            Makeup = ["2026-05-09"],
            Greeting = "劳动节快乐。辛苦了这么久，今晚该好好休息",
            Eve = ["假期前夜，明天可以睡到自然醒"],
        },
        new HolidayRange
        {
            Name = "端午节",
            Start = "2026-06-19",
            End = "2026-06-21",
            Makeup = [],
            Greeting = "端午安康。粽子明天再吃，今晚先睡",
            Eve = ["明天是端午，今晚早点收工"],
        },
        new HolidayRange
        {
            Name = "中秋节",
            Start = "2026-09-25",
            End = "2026-09-27",
            Makeup = [],
            Greeting = "中秋快乐。月光很好，但闭眼更好",
            Eve = ["明天是中秋，今晚早些歇下"],
        },
        new HolidayRange
        {
            Name = "国庆节",
            Start = "2026-10-01",
            End = "2026-10-07",
            Makeup = ["2026-09-20", "2026-10-10"],
            Greeting = "国庆快乐。假期很长，睡眠也要够长",
            Eve = ["明天就是国庆假期了，今晚睡个好觉，假期好好放松"],
        },
    ];

    /// <summary>
    /// 国务院通知中写明的星期，用于自检逐日核对。
    /// 元素为 <c>(日期, 星期, 说明)</c>，星期取值与 <see cref="DayOfWeek"/> 一致（0 = 周日）。
    /// </summary>
    public static readonly IReadOnlyList<(string DateKey, int Weekday, string Label)> OfficialWeekdays =
    [
        ("2026-01-01", 4, "元旦首日 周四"),
        ("2026-01-03", 6, "元旦末日 周六"),
        ("2026-01-04", 0, "元旦调休上班 周日"),
        ("2026-02-15", 0, "春节首日 周日"),
        ("2026-02-23", 1, "春节末日 周一"),
        ("2026-02-14", 6, "春节调休上班 周六"),
        ("2026-02-28", 6, "春节调休上班 周六"),
        ("2026-04-04", 6, "清明首日 周六"),
        ("2026-04-06", 1, "清明末日 周一"),
        ("2026-05-01", 5, "劳动节首日 周五"),
        ("2026-05-05", 2, "劳动节末日 周二"),
        ("2026-05-09", 6, "劳动节调休上班 周六"),
        ("2026-06-19", 5, "端午首日 周五"),
        ("2026-06-21", 0, "端午末日 周日"),
        ("2026-09-25", 5, "中秋首日 周五"),
        ("2026-09-27", 0, "中秋末日 周日"),
        ("2026-10-01", 4, "国庆首日 周四"),
        ("2026-10-07", 3, "国庆末日 周三"),
        ("2026-09-20", 0, "国庆调休上班 周日"),
        ("2026-10-10", 6, "国庆调休上班 周六"),
    ];

    /// <summary>各节日的放假天数（与通知一致），供自检断言。</summary>
    public static readonly IReadOnlyDictionary<string, int> ExpectedHolidayDays = new Dictionary<string, int>(StringComparer.Ordinal)
    {
        ["元旦"] = 3,
        ["春节"] = 9,
        ["清明节"] = 3,
        ["劳动节"] = 5,
        ["端午节"] = 3,
        ["中秋节"] = 3,
        ["国庆节"] = 7,
    };

    private static readonly Dictionary<string, DateInfo> Index = BuildIndex();

    private static Dictionary<string, DateInfo> BuildIndex()
    {
        var index = new Dictionary<string, DateInfo>(StringComparer.Ordinal);
        foreach (var range in Ranges)
        {
            IndexRange(index, range);
        }

        return index;
    }

    private static void IndexRange(Dictionary<string, DateInfo> index, HolidayRange range)
    {
        var from = TimeUtil.ParseDateKey(range.Start);
        var to = TimeUtil.ParseDateKey(range.End);
        var days = (int)Math.Round((to - from).TotalDays, MidpointRounding.AwayFromZero) + 1;
        if (days <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(range), $"节假日区间非法：{range.Start} ~ {range.End}");
        }

        for (var offset = 0; offset < days; offset++)
        {
            var key = TimeUtil.DateKey(TimeUtil.AddDays(from, offset));
            index[key] = new DateInfo(key, range.Name, DateInfo.KindHoliday, range);
        }

        foreach (var makeup in range.Makeup)
        {
            index[makeup] = new DateInfo(makeup, range.Name, DateInfo.KindMakeup, range);
        }
    }

    /// <summary>某节日区间的放假天数。</summary>
    public static int DayCountOf(HolidayRange range)
    {
        var from = TimeUtil.ParseDateKey(range.Start);
        var to = TimeUtil.ParseDateKey(range.End);
        return (int)Math.Round((to - from).TotalDays, MidpointRounding.AwayFromZero) + 1;
    }

    /// <summary>该年的数据覆盖区间，用于设置页提示。</summary>
    public static IReadOnlyList<string> CoveredYears =>
        Index.Keys.Select(key => key[..4]).Distinct(StringComparer.Ordinal).OrderBy(y => y, StringComparer.Ordinal).ToList();

    public static bool HasDataForYear(int year) => Index.Keys.Any(key => key.StartsWith($"{year:0000}-", StringComparison.Ordinal));

    /// <summary>查询某一天的节假日属性；不是特殊日期时返回 null。</summary>
    public static DateInfo? GetDateInfo(DateTime date) => GetDateInfo(TimeUtil.DateKey(date));

    public static DateInfo? GetDateInfo(string dateKey) =>
        Index.TryGetValue(dateKey ?? string.Empty, out var info) ? info : null;

    public static bool IsHoliday(DateTime date) => GetDateInfo(date)?.IsHoliday ?? false;

    public static bool IsMakeupWorkday(DateTime date) => GetDateInfo(date)?.IsMakeup ?? false;

    /// <summary>节假日语境：同时看昨天 / 今天 / 明天。</summary>
    public static HolidayContext HolidayContextOf(DateTime date) => new(
        GetDateInfo(TimeUtil.AddDays(date, -1)),
        GetDateInfo(date),
        GetDateInfo(TimeUtil.AddDays(date, 1)));

    /// <summary>按节日名称取回原始区间（文案生成需要 greeting / eve）。</summary>
    public static HolidayRange? GetRangeByName(string name) =>
        Ranges.FirstOrDefault(range => string.Equals(range.Name, name, StringComparison.Ordinal));

    /// <summary>所有调休上班日的扁平列表（6 个），供自检断言。</summary>
    public static IReadOnlyList<string> AllMakeupDays =>
        Ranges.SelectMany(range => range.Makeup).ToList();
}
