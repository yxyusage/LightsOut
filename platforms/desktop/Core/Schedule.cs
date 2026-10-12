namespace Xideng.Desktop.Core;

/// <summary>
/// 一段具体的熄灯区间。<c>Start</c> / <c>End</c> 已解析为绝对时刻。
/// </summary>
public sealed record ScheduleWindow(
    DateTime Start,
    DateTime End,
    string DayType,
    bool CrossesMidnight,
    string StartKey)
{
    public long DurationMs => (long)(End - Start).TotalMilliseconds;
}

/// <summary>引擎相位判定结果。</summary>
public sealed record PhaseInfo(string Phase, ScheduleWindow? Window, long RemainingMs, long WarnMs, bool Dismissed);

/// <summary>
/// 熄灯早睡 · 睡眠计划与相位判定（<c>packages/core/src/schedule.js</c> 的 C# 移植）。
///
/// 这里是 PRD 2.1「睡眠计划管理」与 2.2.1「进入触发逻辑」的纯逻辑实现。
/// 关键点：熄灯时段支持跨天（23:00 → 次日 07:00），所以判定"此刻是否在熄灯中"
/// 必须<b>同时检查"今天开启的时段"和"昨天开启的时段"</b>。
/// </summary>
public static class ScheduleEngine
{
    /// <summary>
    /// 判定某一天按哪套时段执行。
    /// 相比 PRD 的"工作日 / 周末"二分，这里多加了两层：
    /// <list type="bullet">
    ///   <item><b>调休上班日</b>：法定调休把某个周六变成上班日，用户当天仍在上班，晚上理应按工作日时段熄灯；</item>
    ///   <item><b>周日晚按工作日</b>（<see cref="PlanSettings.SundayAsWeekday"/>，默认开）：
    ///   周日晚上开启的时段按工作日配置执行，避免"周日晚睡、周一早起"失去保护。</item>
    /// </list>
    /// </summary>
    public static string DayTypeOf(DateTime date, bool respectMakeupWorkdays = true, bool sundayAsWeekday = true)
    {
        if (respectMakeupWorkdays && Holidays.IsMakeupWorkday(date))
        {
            return Core.DayType.Weekday;
        }

        if (sundayAsWeekday && date.DayOfWeek == DayOfWeek.Sunday)
        {
            return Core.DayType.Weekday;
        }

        return TimeUtil.IsWeekend(date) ? Core.DayType.Weekend : Core.DayType.Weekday;
    }

    /// <summary>
    /// 构造"以某一天为起点"的熄灯区间。
    /// </summary>
    public static ScheduleWindow? WindowForDate(
        PlanSettings? plan,
        DateTime date,
        bool respectMakeupWorkdays = true,
        bool sundayAsWeekday = true)
    {
        if (plan?.Windows is null)
        {
            return null;
        }

        var dayType = DayTypeOf(date, respectMakeupWorkdays, sundayAsWeekday);
        if (!plan.Windows.TryGetValue(dayType, out var config) || config is null)
        {
            return null;
        }

        if (!TimeUtil.TryToMinutes(config.Start, out var startMinutes) ||
            !TimeUtil.TryToMinutes(config.End, out var endMinutes))
        {
            return null;
        }

        // start === end 视为未配置（既非 0 分钟也非 24 小时，语义含糊），交由 UI 校验提示
        if (startMinutes == endMinutes)
        {
            return null;
        }

        var crossesMidnight = endMinutes < startMinutes;
        var day = TimeUtil.StartOfDay(date);
        var start = TimeUtil.AddMinutes(day, startMinutes);
        var end = TimeUtil.AddMinutes(day, crossesMidnight ? endMinutes + TimeUtil.MinutesPerDay : endMinutes);

        return new ScheduleWindow(start, end, dayType, crossesMidnight, TimeUtil.DateKey(date));
    }

    /// <summary>
    /// 此刻是否处于熄灯时段内；是则返回该区间。
    /// 只需检查偏移 0 与 -1 天：单次时段必然短于 24 小时。
    /// </summary>
    public static ScheduleWindow? ActiveWindowAt(
        PlanSettings? plan,
        DateTime now,
        bool respectMakeupWorkdays = true,
        bool sundayAsWeekday = true)
    {
        if (plan is null || !plan.Enabled)
        {
            return null;
        }

        foreach (var offset in new[] { 0, -1 })
        {
            var window = WindowForDate(plan, TimeUtil.AddDays(now, offset), respectMakeupWorkdays, sundayAsWeekday);
            if (window is not null && now >= window.Start && now < window.End)
            {
                return window;
            }
        }

        return null;
    }

    /// <summary>此刻之后最早开始的熄灯区间。</summary>
    public static ScheduleWindow? NextWindowAt(
        PlanSettings? plan,
        DateTime now,
        bool respectMakeupWorkdays = true,
        bool sundayAsWeekday = true)
    {
        if (plan is null || !plan.Enabled)
        {
            return null;
        }

        ScheduleWindow? earliest = null;
        foreach (var offset in new[] { 0, 1, 2 })
        {
            var window = WindowForDate(plan, TimeUtil.AddDays(now, offset), respectMakeupWorkdays, sundayAsWeekday);
            if (window is not null && window.Start > now && (earliest is null || window.Start < earliest.Start))
            {
                earliest = window;
            }
        }

        return earliest;
    }

    /// <summary>
    /// 求此刻的引擎相位。这是整个应用唯一的时间判定入口。
    /// </summary>
    /// <param name="plan">睡眠计划。</param>
    /// <param name="now">当前时刻（由调用方注入）。</param>
    /// <param name="warnMinutes">提前预告分钟数；null 表示取 plan 自身的值。</param>
    /// <param name="dismissedWindowKey">被紧急解除的时段开始日键。</param>
    /// <param name="respectMakeupWorkdays">是否把调休上班日按工作日处理。</param>
    /// <param name="sundayAsWeekday">周日晚按工作日执行（<see cref="PlanSettings.SundayAsWeekday"/>）。</param>
    public static PhaseInfo PhaseAt(
        PlanSettings? plan,
        DateTime now,
        int? warnMinutes = null,
        string? dismissedWindowKey = null,
        bool respectMakeupWorkdays = true,
        bool sundayAsWeekday = true)
    {
        var effectiveWarn = warnMinutes ?? plan?.WarnMinutes ?? 0;

        if (plan is null || !plan.Enabled)
        {
            return new PhaseInfo(Phase.Off, null, 0, 0, false);
        }

        var active = ActiveWindowAt(plan, now, respectMakeupWorkdays, sundayAsWeekday);
        if (active is not null)
        {
            // 紧急解除只作用于"当前这一次"时段，次日计划照常生效（PRD 2.2.5）
            var dismissed = string.Equals(dismissedWindowKey, active.StartKey, StringComparison.Ordinal);
            return new PhaseInfo(
                dismissed ? Phase.Off : Phase.Active,
                active,
                Math.Max(0L, (long)(active.End - now).TotalMilliseconds),
                0,
                dismissed);
        }

        var next = NextWindowAt(plan, now, respectMakeupWorkdays, sundayAsWeekday);
        if (next is null)
        {
            return new PhaseInfo(Phase.Idle, null, 0, 0, false);
        }

        var untilStartMs = (long)(next.Start - now).TotalMilliseconds;
        var warnMs = Math.Max(0, effectiveWarn) * TimeUtil.MsMinute;
        var inWarning = warnMs > 0 && untilStartMs <= warnMs;

        return new PhaseInfo(
            inWarning ? Phase.Warning : Phase.Idle,
            next,
            untilStartMs,
            warnMs,
            false);
    }

    /// <summary>
    /// 校验一套时段配置，返回人类可读的问题列表（空数组表示合法）。
    /// </summary>
    public static IReadOnlyList<string> ValidateWindow(string? start, string? end)
    {
        var problems = new List<string>();

        if (!TimeUtil.TryToMinutes(start, out var startMinutes))
        {
            problems.Add("开始时间格式应为 HH:MM");
        }

        if (!TimeUtil.TryToMinutes(end, out var endMinutes))
        {
            problems.Add("结束时间格式应为 HH:MM");
        }

        if (problems.Count > 0)
        {
            return problems;
        }

        if (startMinutes == endMinutes)
        {
            problems.Add("开始时间与结束时间不能相同");
            return problems;
        }

        // 熄灯模式必须是"晚上睡到早上"：结束时间必须早于开始时间（跨越午夜）。
        // 白天的时段（如 07:00→12:00）不符合产品语义，直接判非法。
        if (endMinutes > startMinutes)
        {
            problems.Add("熄灯时段必须跨越午夜（结束时间应早于开始时间，如 23:00 → 次日 07:00）");
            return problems;
        }

        var durationMinutes = ((endMinutes - startMinutes) + TimeUtil.MinutesPerDay) % TimeUtil.MinutesPerDay;
        if (durationMinutes < 30)
        {
            problems.Add("熄灯时段不应短于 30 分钟");
        }

        if (durationMinutes > 16 * 60)
        {
            problems.Add("熄灯时段不宜长于 16 小时");
        }

        return problems;
    }
}
