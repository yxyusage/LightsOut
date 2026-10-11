namespace Xideng.Desktop.Core;

/// <summary>
/// 熄灯早睡 · 时间与日期基础工具（<c>packages/core/src/time.js</c> 的 C# 移植）
///
/// 与 JS 版保持一致的设计约定：<b>本类所有成员都是纯函数，从不读取系统当前时间</b>。
/// 当前时间一律由调用方（引擎 / UI / 自检）注入，这样熄灯逻辑才能在测试里被
/// 完整地"穿越时间"验证，也便于桌面端与 Web 端复用同一套判定语义。
///
/// 等价性注意点：JS <c>Date#getDay()</c> 的 0 表示周日，C# <c>DayOfWeek</c> 的 0 也表示周日，
/// 因此 <see cref="WeekdayNames"/> 的索引可以直接用 <c>(int)date.DayOfWeek</c>，无需换算。
/// </summary>
public static class TimeUtil
{
    public const long MsMinute = 60_000L;
    public const long MsHour = 3_600_000L;
    public const long MsDay = 86_400_000L;
    public const int MinutesPerDay = 1440;

    /// <summary>与 JavaScript <c>Date#getDay()</c> 对齐：0 = 周日 … 6 = 周六。</summary>
    public static readonly string[] WeekdayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

    /// <summary>两位补零。</summary>
    public static string Pad2(int value) => value.ToString("00", System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>
    /// <c>"23:00"</c> → <c>1380</c>（自当日 00:00 起的分钟数）。
    /// </summary>
    /// <exception cref="ArgumentOutOfRangeException">格式非法或超出取值范围。</exception>
    public static int ToMinutes(string? hhmm)
    {
        var text = (hhmm ?? string.Empty).Trim();
        // 与 JS 正则 /^(\d{1,2}):(\d{2})$/ 等价：必须是完整匹配
        var parts = text.Split(':');
        if (parts.Length != 2)
        {
            throw new ArgumentOutOfRangeException(nameof(hhmm), hhmm, "时间格式非法，应为 HH:MM");
        }

        var hourText = parts[0];
        var minuteText = parts[1];
        if (hourText.Length is < 1 or > 2 || minuteText.Length != 2)
        {
            throw new ArgumentOutOfRangeException(nameof(hhmm), hhmm, "时间格式非法，应为 HH:MM");
        }

        foreach (var ch in hourText)
        {
            if (!char.IsAsciiDigit(ch))
            {
                throw new ArgumentOutOfRangeException(nameof(hhmm), hhmm, "时间格式非法，应为 HH:MM");
            }
        }

        foreach (var ch in minuteText)
        {
            if (!char.IsAsciiDigit(ch))
            {
                throw new ArgumentOutOfRangeException(nameof(hhmm), hhmm, "时间格式非法，应为 HH:MM");
            }
        }

        var hours = int.Parse(hourText, System.Globalization.CultureInfo.InvariantCulture);
        var minutes = int.Parse(minuteText, System.Globalization.CultureInfo.InvariantCulture);
        if (hours > 23 || minutes > 59)
        {
            throw new ArgumentOutOfRangeException(nameof(hhmm), hhmm, "时间超出范围");
        }

        return (hours * 60) + minutes;
    }

    /// <summary>尝试解析，失败返回 false（供 UI 校验使用，不抛异常）。</summary>
    public static bool TryToMinutes(string? hhmm, out int minutes)
    {
        try
        {
            minutes = ToMinutes(hhmm);
            return true;
        }
        catch (ArgumentOutOfRangeException)
        {
            minutes = 0;
            return false;
        }
    }

    /// <summary><c>1380</c> → <c>"23:00"</c>，自动按一天取模。</summary>
    public static string FromMinutes(int totalMinutes)
    {
        var normalized = ((totalMinutes % MinutesPerDay) + MinutesPerDay) % MinutesPerDay;
        return $"{Pad2(normalized / 60)}:{Pad2(normalized % 60)}";
    }

    /// <summary>当日 00:00:00.000。</summary>
    public static DateTime StartOfDay(DateTime date) => date.Date;

    /// <summary>当日 23:59:59.999。</summary>
    public static DateTime EndOfDay(DateTime date) => date.Date.AddDays(1).AddTicks(-1);

    /// <summary>按"日历日"偏移，跨夏令时时仍稳定落在同一天。</summary>
    public static DateTime AddDays(DateTime date, int days) => date.Date.AddDays(days);

    public static DateTime AddMinutes(DateTime date, int minutes) => date.AddMinutes(minutes);

    /// <summary><c>2026-01-01</c>（本地时区日历日，不含时间部分）。</summary>
    public static string DateKey(DateTime date) => $"{date.Year:0000}-{Pad2(date.Month)}-{Pad2(date.Day)}";

    /// <summary><c>"2026-01-01"</c> → 本地时区当日 00:00。</summary>
    /// <exception cref="ArgumentOutOfRangeException">格式非法。</exception>
    public static DateTime ParseDateKey(string? key)
    {
        var text = (key ?? string.Empty).Trim();
        var parts = text.Split('-');
        if (parts.Length != 3 || parts[0].Length != 4 || parts[1].Length != 2 || parts[2].Length != 2)
        {
            throw new ArgumentOutOfRangeException(nameof(key), key, "日期格式非法，应为 YYYY-MM-DD");
        }

        foreach (var part in parts)
        {
            foreach (var ch in part)
            {
                if (!char.IsAsciiDigit(ch))
                {
                    throw new ArgumentOutOfRangeException(nameof(key), key, "日期格式非法，应为 YYYY-MM-DD");
                }
            }
        }

        var year = int.Parse(parts[0], System.Globalization.CultureInfo.InvariantCulture);
        var month = int.Parse(parts[1], System.Globalization.CultureInfo.InvariantCulture);
        var day = int.Parse(parts[2], System.Globalization.CultureInfo.InvariantCulture);
        if (month is < 1 or > 12 || day < 1 || day > DateTime.DaysInMonth(year, month))
        {
            throw new ArgumentOutOfRangeException(nameof(key), key, "日期超出范围");
        }

        return new DateTime(year, month, day, 0, 0, 0, DateTimeKind.Local);
    }

    public static bool IsSameDay(DateTime a, DateTime b) => a.Date == b.Date;

    public static bool IsWeekend(DateTime date) =>
        date.DayOfWeek is DayOfWeek.Sunday or DayOfWeek.Saturday;

    public static string WeekdayName(DateTime date) => WeekdayNames[(int)date.DayOfWeek];

    /// <summary>相隔的日历天数（b - a），忽略时分秒。</summary>
    public static int DaysBetween(DateTime a, DateTime b) =>
        (int)Math.Round((StartOfDay(b) - StartOfDay(a)).TotalDays, MidpointRounding.AwayFromZero);

    /// <summary><c>"23:04"</c>；<paramref name="seconds"/> 为 true 时输出 <c>"23:04:15"</c>。</summary>
    public static string FormatClock(DateTime date, bool seconds = false)
    {
        var clock = $"{Pad2(date.Hour)}:{Pad2(date.Minute)}";
        return seconds ? $"{clock}:{Pad2(date.Second)}" : clock;
    }

    /// <summary>
    /// 把毫秒时长渲染成中文口语表达，用于"距离本次熄灯结束"。
    /// 例：<c>6h23m</c> → <c>"6 小时 23 分"</c>；<c>23m12s</c> → <c>"23 分 12 秒"</c>；<c>&lt;60s</c> → <c>"不足 1 分钟"</c>。
    /// </summary>
    public static string FormatDurationCn(long ms)
    {
        var total = Math.Max(0L, ms / 1000L);
        var hours = total / 3600L;
        var minutes = (total % 3600L) / 60L;
        var seconds = total % 60L;

        if (hours > 0)
        {
            return minutes > 0 ? $"{hours} 小时 {minutes} 分" : $"{hours} 小时";
        }

        if (minutes > 0)
        {
            return seconds > 0 ? $"{minutes} 分 {seconds} 秒" : $"{minutes} 分";
        }

        return "不足 1 分钟";
    }

    /// <summary>
    /// 倒计时专用：始终带秒，且不足 1 分钟时显示秒数（预告弹窗需要精确读秒）。
    /// 例：<c>754000</c> → <c>"12 分 34 秒"</c>；<c>45000</c> → <c>"45 秒"</c>。
    /// </summary>
    public static string FormatCountdownCn(long ms)
    {
        var total = Math.Max(0L, ms / 1000L);
        var hours = total / 3600L;
        var minutes = (total % 3600L) / 60L;
        var seconds = total % 60L;

        if (hours > 0)
        {
            return $"{hours} 小时 {minutes} 分";
        }

        return minutes > 0 ? $"{minutes} 分 {seconds} 秒" : $"{seconds} 秒";
    }

    /// <summary>一天中的时段分区，供 AI 文案与本地文案挑选合适的语气。</summary>
    public static string TimeBucketOf(DateTime date)
    {
        var hour = date.Hour;
        if (hour >= 22 || hour < 0)
        {
            return TimeBuckets.Late;
        }

        if (hour < 3)
        {
            return TimeBuckets.Midnight;
        }

        if (hour < 5)
        {
            return TimeBuckets.SmallHours;
        }

        if (hour < 7)
        {
            return TimeBuckets.Dawn;
        }

        if (hour < 12)
        {
            return TimeBuckets.Morning;
        }

        if (hour < 18)
        {
            return TimeBuckets.Afternoon;
        }

        return TimeBuckets.Evening;
    }

    public static string TimeBucketLabel(string bucket) =>
        TimeBuckets.Labels.TryGetValue(bucket, out var label) ? label : bucket;
}

/// <summary>时段分区标识与中文标签（对应 JS 的 <c>timeBucketOf</c> 返回值）。</summary>
public static class TimeBuckets
{
    public const string Late = "late";
    public const string Midnight = "midnight";
    public const string SmallHours = "smallHours";
    public const string Dawn = "dawn";
    public const string Morning = "morning";
    public const string Afternoon = "afternoon";
    public const string Evening = "evening";

    public static readonly IReadOnlyDictionary<string, string> Labels = new Dictionary<string, string>
    {
        [Late] = "刚躺下",
        [Midnight] = "深夜",
        [SmallHours] = "后半夜",
        [Dawn] = "天将亮",
        [Morning] = "上午",
        [Afternoon] = "下午",
        [Evening] = "傍晚",
    };
}
