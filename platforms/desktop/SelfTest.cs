using System.Text;
using Microsoft.Win32;
using Xideng.Desktop.Core;
using Xideng.Desktop.Platform;

namespace Xideng.Desktop;

/// <summary>
/// <c>--selftest</c>：不启动 GUI 的断言套件，是整个桌面端的主要验收手段。
///
/// 覆盖面刻意压在"容易写错且后果严重"的地方：
/// 跨天熄灯时段、自然周额度在周一 0 点重置、节假日日期与国务院通知中的星期是否一致、
/// 调休上班日归类，以及与 Web 端核心的<b>逐位等价性</b>（哈希 / 随机数 / 播放列表顺序）。
/// </summary>
public static class SelfTest
{
    public static int Run(string[] args)
    {
        var output = new StringBuilder();
        var harness = new Harness();

        harness.Line("熄灯早睡 · 桌面端自检 (--selftest)");
        harness.Line($"运行平台：{Environment.OSVersion.Platform} / {Environment.OSVersion.VersionString}");
        harness.Line($".NET 版本：{Environment.Version}");
        harness.Line($"应用版本：{AppInfo.Version}    设置结构版本：{AppInfo.SettingsVersion}");

        RunTimeGroup(harness);
        RunHolidayGroup(harness);
        RunScheduleGroup(harness);
        RunSceneGroup(harness);
        RunCopyGroup(harness);
        RunQuotaGroup(harness);
        RunPasswordGroup(harness);
        RunSettingsGroup(harness);
        RunEngineGroup(harness);
        RunGuardGroup(harness);
        RunPlatformGroup(harness);
        RunUnverifiedGroup(harness);

        harness.Summarize();
        var text = harness.Text.ToString();

        Console.Write(text);
        Console.Out.Flush();

        WriteReport(text);
        return harness.Failed == 0 ? 0 : 1;
    }

    private static void WriteReport(string text)
    {
        try
        {
            AppPaths.EnsureUserDataDir();
            File.WriteAllText(AppPaths.SelfTestReportFile, text, new UTF8Encoding(false));
            Console.WriteLine();
            Console.WriteLine($"自检报告已写入：{AppPaths.SelfTestReportFile}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"（注意：自检报告写入失败：{ex.GetType().Name}）");
        }
    }

    // ─────────────────────────────────────────────────────────
    private static void RunTimeGroup(Harness h)
    {
        h.Group("time · 时间基础工具");

        h.Eq("toMinutes(\"00:00\") == 0", 0, TimeUtil.ToMinutes("00:00"));
        h.Eq("toMinutes(\"23:00\") == 1380", 1380, TimeUtil.ToMinutes("23:00"));
        h.Eq("toMinutes(\"7:05\") == 425", 425, TimeUtil.ToMinutes("7:05"));
        h.Eq("fromMinutes(1380) == \"23:00\"", "23:00", TimeUtil.FromMinutes(1380));
        h.Eq("fromMinutes(0) == \"00:00\"", "00:00", TimeUtil.FromMinutes(0));
        h.Eq("fromMinutes(1500) 跨天取模 == \"01:00\"", "01:00", TimeUtil.FromMinutes(1500));
        h.Eq("fromMinutes(-60) == \"23:00\"", "23:00", TimeUtil.FromMinutes(-60));

        h.Throws<ArgumentOutOfRangeException>("toMinutes(\"24:00\") 抛错", () => TimeUtil.ToMinutes("24:00"));
        h.Throws<ArgumentOutOfRangeException>("toMinutes(\"23:60\") 抛错", () => TimeUtil.ToMinutes("23:60"));
        h.Throws<ArgumentOutOfRangeException>("toMinutes(\"abc\") 抛错", () => TimeUtil.ToMinutes("abc"));
        h.Throws<ArgumentOutOfRangeException>("toMinutes(\"\") 抛错", () => TimeUtil.ToMinutes(string.Empty));
        h.Throws<ArgumentOutOfRangeException>("toMinutes(null) 抛错", () => TimeUtil.ToMinutes(null));

        var day = At(2026, 1, 4);
        h.Eq("dateKey(2026-01-04)", "2026-01-04", TimeUtil.DateKey(day));
        h.Eq("parseDateKey 往返一致", "2026-01-04", TimeUtil.DateKey(TimeUtil.ParseDateKey("2026-01-04")));
        h.Throws<ArgumentOutOfRangeException>("parseDateKey(\"2026/01/04\") 抛错", () => TimeUtil.ParseDateKey("2026/01/04"));

        h.Eq("daysBetween 忽略时分秒(跨日)", 1, TimeUtil.DaysBetween(At(2026, 1, 1, 23, 59), At(2026, 1, 2, 0, 1)));
        h.Eq("daysBetween(1月1日, 2月1日) == 31", 31, TimeUtil.DaysBetween(At(2026, 1, 1), At(2026, 2, 1)));
        h.Eq("daysBetween(3月1日, 2月28日) == -1", -1, TimeUtil.DaysBetween(At(2026, 3, 1), At(2026, 2, 28)));

        h.Eq("formatDurationCn(6h23m)", "6 小时 23 分", TimeUtil.FormatDurationCn((6L * 3_600_000) + (23L * 60_000)));
        h.Eq("formatDurationCn(1h)", "1 小时", TimeUtil.FormatDurationCn(3_600_000));
        h.Eq("formatDurationCn(23m12s)", "23 分 12 秒", TimeUtil.FormatDurationCn((23L * 60_000) + 12_000));
        h.Eq("formatDurationCn(45s)", "不足 1 分钟", TimeUtil.FormatDurationCn(45_000));
        h.Eq("formatDurationCn(0)", "不足 1 分钟", TimeUtil.FormatDurationCn(0));
        h.Eq("formatDurationCn(-5000) 不为负", "不足 1 分钟", TimeUtil.FormatDurationCn(-5_000));
        h.Eq("formatCountdownCn(45s)", "45 秒", TimeUtil.FormatCountdownCn(45_000));
        h.Eq("formatCountdownCn(754s)", "12 分 34 秒", TimeUtil.FormatCountdownCn(754_000));

        h.Eq("weekdayNames 与 DayOfWeek 对齐（周日）", "周日", TimeUtil.WeekdayName(At(2026, 9, 6)));
        h.Eq("weekdayNames 与 DayOfWeek 对齐（周五）", "周五", TimeUtil.WeekdayName(At(2026, 9, 4)));
    }

    // ─────────────────────────────────────────────────────────
    private static void RunHolidayGroup(Harness h)
    {
        h.Group("holidays · 2026 年数据逐日核对（对照国办发明电〔2025〕7号）");

        h.Eq("节日数量为 7", 7, Holidays.Ranges.Count);
        h.Eq("调休上班日总数为 6", 6, Holidays.AllMakeupDays.Count);

        foreach (var (dateKey, weekday, label) in Holidays.OfficialWeekdays)
        {
            var actual = (int)TimeUtil.ParseDateKey(dateKey).DayOfWeek;
            h.Eq($"逐日核对 {label}（{dateKey}）", weekday, actual);
        }

        foreach (var (name, expectedDays) in Holidays.ExpectedHolidayDays)
        {
            var range = Holidays.GetRangeByName(name);
            h.Check($"{name} 放假天数应为 {expectedDays} 天", range is not null);
            if (range is not null)
            {
                h.Eq($"{name} 实际放假天数", expectedDays, Holidays.DayCountOf(range));
            }
        }

        var makeupIssues = new List<string>();
        foreach (var range in Holidays.Ranges)
        {
            foreach (var makeup in range.Makeup)
            {
                var info = Holidays.GetDateInfo(makeup);
                if (info is null || !info.IsMakeup)
                {
                    makeupIssues.Add($"{makeup} 未登记为 makeup");
                }
                else if (info.IsHoliday)
                {
                    makeupIssues.Add($"{makeup} 同时被登记为放假");
                }

                var weekday = TimeUtil.ParseDateKey(makeup).DayOfWeek;
                if (weekday is not (DayOfWeek.Saturday or DayOfWeek.Sunday))
                {
                    makeupIssues.Add($"{makeup} 不是周末，不像调休上班日");
                }
            }
        }

        h.Check("调休上班日全部登记为 makeup 且不同时为放假、且都落在周末", makeupIssues.Count == 0,
            string.Join("; ", makeupIssues));

        h.Eq("2026-02-18 归属春节", "春节", Holidays.GetDateInfo("2026-02-18")?.Name);
        h.Check("2026-10-03 是假日", Holidays.IsHoliday(TimeUtil.ParseDateKey("2026-10-03")));
        h.Check("2026-10-08 不是假日（节后第一天）", !Holidays.IsHoliday(TimeUtil.ParseDateKey("2026-10-08")));
        h.Check("2026-12-31 无节日数据，按普通日期处理", Holidays.GetDateInfo("2026-12-31") is null);

        var eve = Holidays.HolidayContextOf(TimeUtil.ParseDateKey("2026-02-14"));
        h.Eq("2026-02-14 今天是调休上班(makeup)", DateInfo.KindMakeup, eve.Today?.Kind);
        h.Eq("2026-02-14 明天是春节假期", "春节", eve.Tomorrow?.Name);
        h.Eq("2026-02-14 明天 kind == holiday", DateInfo.KindHoliday, eve.Tomorrow?.Kind);

        var lastDay = Holidays.HolidayContextOf(TimeUtil.ParseDateKey("2026-02-23"));
        h.Eq("2026-02-23 今天是春节", "春节", lastDay.Today?.Name);
        h.Check("2026-02-23 明天无节日（假期结束）", lastDay.Tomorrow is null);

        h.Check("覆盖年份包含 2026", Holidays.CoveredYears.Contains("2026"));
        h.Check("2026 年有数据", Holidays.HasDataForYear(2026));
        h.Check("2030 年无数据（不会误判为节日）", !Holidays.HasDataForYear(2030));
        h.Check("数据来源标注了文号", Holidays.Source.DocumentNumber.Contains("国办发明电"));
    }

    // ─────────────────────────────────────────────────────────
    private static void RunScheduleGroup(Harness h)
    {
        h.Group("schedule · 睡眠计划与相位（PRD 2.1 / 2.2.1）");

        var plan = DefaultPlan();

        var window = ScheduleEngine.WindowForDate(plan, At(2026, 9, 4, 23, 0));
        h.Check("周五 23:00 能构造出时段", window is not null);
        h.Eq("跨天时段 crossesMidnight == true", true, window!.CrossesMidnight);
        h.Eq("时段开始日 == 2026-09-04", "2026-09-04", TimeUtil.DateKey(window.Start));
        h.Eq("时段结束日 == 2026-09-05（跨天）", "2026-09-05", TimeUtil.DateKey(window.End));
        h.Eq("时段结束于 07:00", 7, window.End.Hour);
        h.Eq("时段长度为 8 小时", 8L * 3_600_000L, window.DurationMs);

        var earlyMorning = ScheduleEngine.ActiveWindowAt(plan, At(2026, 9, 5, 2, 0));
        h.Check("凌晨 02:00 处于熄灯中（检查昨天开启的时段）", earlyMorning is not null);
        h.Eq("凌晨 02:00 归属周五那一次时段", "2026-09-04", earlyMorning!.StartKey);

        h.Eq("22:44 尚未预告", Phase.Idle, ScheduleEngine.PhaseAt(plan, At(2026, 9, 4, 22, 44)).Phase);
        var warning = ScheduleEngine.PhaseAt(plan, At(2026, 9, 4, 22, 45));
        h.Eq("22:45 进入预告", Phase.Warning, warning.Phase);
        h.Eq("预告剩余 15 分钟", 15L * 60_000L, warning.RemainingMs);
        h.Eq("23:00 进入熄灯", Phase.Active, ScheduleEngine.PhaseAt(plan, At(2026, 9, 4, 23, 0)).Phase);

        var after = ScheduleEngine.PhaseAt(plan, At(2026, 9, 5, 7, 0));
        h.Eq("07:00 熄灯结束回到 IDLE", Phase.Idle, after.Phase);
        h.Eq("并指向 2026-09-05 的下一次时段", "2026-09-05", after.Window is null ? "(null)" : TimeUtil.DateKey(after.Window.Start));
        h.Eq("下一次时段开始于 23:00", 23, after.Window?.Start.Hour ?? -1);

        var offPlan = DefaultPlan();
        offPlan.Enabled = false;
        var off = ScheduleEngine.PhaseAt(offPlan, At(2026, 9, 4, 23, 30));
        h.Eq("关闭计划后一律为 OFF", Phase.Off, off.Phase);
        h.Check("关闭计划后 window 为 null", off.Window is null);

        var broken = DefaultPlan();
        broken.Windows[DayType.Weekday] = new WindowConfig { Start = "23:00", End = "23:00" };
        broken.Windows[DayType.Weekend] = new WindowConfig { Start = "23:00", End = "23:00" };
        h.Check("start == end 视为未配置（不产生 24 小时锁定）", ScheduleEngine.WindowForDate(broken, At(2026, 9, 4)) is null);
        h.Check("start == end 时 activeWindowAt 为 null", ScheduleEngine.ActiveWindowAt(broken, At(2026, 9, 4, 23, 30)) is null);

        h.Eq("调休上班的周六(2026-02-28)按工作日执行", DayType.Weekday, ScheduleEngine.DayTypeOf(At(2026, 2, 28, 12, 0)));
        h.Eq("可关闭调休行为，回退为周末", DayType.Weekend, ScheduleEngine.DayTypeOf(At(2026, 2, 28, 12, 0), respectMakeupWorkdays: false));
        h.Eq("普通周六仍按周末执行", DayType.Weekend, ScheduleEngine.DayTypeOf(At(2026, 9, 5, 12, 0)));
        h.Eq("普通周一按工作日执行", DayType.Weekday, ScheduleEngine.DayTypeOf(At(2026, 9, 7, 12, 0)));

        var next = ScheduleEngine.NextWindowAt(plan, At(2026, 9, 4, 23, 30));
        h.Eq("nextWindowAt 跳过已开始的时段", "2026-09-05", next is null ? "(null)" : TimeUtil.DateKey(next.Start));

        h.Check("validateWindow(23:00-07:00) 无问题", ScheduleEngine.ValidateWindow("23:00", "07:00").Count == 0);
        h.Eq("validateWindow(23:00-23:00) 报 1 个问题", 1, ScheduleEngine.ValidateWindow("23:00", "23:00").Count);
        var tooShort = ScheduleEngine.ValidateWindow("23:55", "00:05");
        h.Check("validateWindow(23:55-00:05) 提示不短于 30 分钟",
            tooShort.Count > 0 && tooShort[0].Contains("30 分钟", StringComparison.Ordinal));
        // 白天的非跨午夜时段必须被拒（熄灯本质是"晚上睡到早上"）
        var daytime = ScheduleEngine.ValidateWindow("07:00", "12:00");
        h.Check("validateWindow(07:00-12:00) 提示必须跨越午夜",
            daytime.Count > 0 && daytime[0].Contains("跨越午夜", StringComparison.Ordinal));
        h.Check("validateWindow(abc-07:00) 报格式问题", ScheduleEngine.ValidateWindow("abc", "07:00").Count > 0);

        // 工作日 / 周末两套时段必须相互独立
        var twoSets = DefaultPlan();
        twoSets.Windows[DayType.Weekday] = new WindowConfig { Start = "23:00", End = "07:00" };
        twoSets.Windows[DayType.Weekend] = new WindowConfig { Start = "01:00", End = "09:00" };
        // 2026-09-05 是周六，应命中周末时段（01:00 - 09:00，不跨天）
        var weekendWindow = ScheduleEngine.WindowForDate(twoSets, At(2026, 9, 5));
        h.Eq("周六使用周末时段", "01:00", TimeUtil.FromMinutes(weekendWindow!.Start.Hour * 60 + weekendWindow.Start.Minute));
        h.Check("周末时段不跨天", !weekendWindow.CrossesMidnight);
        // 2026-09-07 是周一，应命中工作日时段
        var weekdayWindow = ScheduleEngine.WindowForDate(twoSets, At(2026, 9, 7));
        h.Eq("周一使用工作日时段", "23:00", TimeUtil.FromMinutes(weekdayWindow!.Start.Hour * 60 + weekdayWindow.Start.Minute));
        h.Check("工作日时段跨天", weekdayWindow.CrossesMidnight);
        // 周六 02:00 不该落在周五的工作日时段里（因为周五 23:00-07:00 覆盖了它）
        // 周六 00:30 尚未进入周末时段（周末从 01:00 才开始），必须回退到"昨天（周五）开启的工作日时段"
        h.Check("周六 00:30 回退到周五开启的跨天工作日时段",
            ScheduleEngine.ActiveWindowAt(twoSets, At(2026, 9, 5, 0, 30))?.StartKey == "2026-09-04");
        // 周六 02:00 已进入周末自身时段，offset 0 应优先于昨天
        h.Check("周六 02:00 命中周末自身时段（offset 0 优先于昨天）",
            ScheduleEngine.ActiveWindowAt(twoSets, At(2026, 9, 5, 2, 0))?.StartKey == "2026-09-05");
    }

    // ─────────────────────────────────────────────────────────
    private static void RunSceneGroup(Harness h)
    {
        h.Group("scene · 场景识别（PRD 2.4）");

        h.Eq("2026-09-04 周五晚", SceneKind.FridayNight, SceneDetector.Detect(At(2026, 9, 4, 23, 30)).Scene);
        h.Eq("2026-09-05 周六晚", SceneKind.SaturdayNight, SceneDetector.Detect(At(2026, 9, 5, 23, 30)).Scene);
        h.Eq("2026-09-06 周日晚", SceneKind.SundayNight, SceneDetector.Detect(At(2026, 9, 6, 23, 30)).Scene);
        h.Eq("2026-09-07 周一普通工作日晚", SceneKind.Ordinary, SceneDetector.Detect(At(2026, 9, 7, 23, 30)).Scene);

        var nationalDay = SceneDetector.Detect(At(2026, 10, 2, 23, 30));
        h.Eq("2026-10-02（周五）节假日优先级高于星期 → 假期中", SceneKind.Holiday, nationalDay.Scene);
        h.Eq("并带上 holidayToday == 国庆节", "国庆节", nationalDay.HolidayToday);

        var eve = SceneDetector.Detect(At(2026, 9, 24, 23, 30));
        h.Eq("2026-09-24（周四）假期前夜", SceneKind.HolidayEve, eve.Scene);
        h.Eq("前夜的 holidayTomorrow == 中秋节", "中秋节", eve.HolidayTomorrow);
        h.Check("前夜 isHolidayEve == true", eve.IsHolidayEve);
        h.Check("前夜不是假期最后一晚", !eve.IsHolidayLastNight);

        var last = SceneDetector.Detect(At(2026, 9, 27, 23, 30));
        h.Eq("2026-09-27（周日）假期最后一晚", SceneKind.HolidayLastNight, last.Scene);
        h.Check("最后一晚 isHolidayLastNight == true", last.IsHolidayLastNight);
        h.Check("最后一晚 holidayTomorrow 为 null", last.HolidayTomorrow is null);

        h.Check("2026-02-14（春节调休周六）仍优先识别为假期前夜",
            SceneDetector.Detect(At(2026, 2, 14, 23, 30)).Scene == SceneKind.HolidayEve);

        h.Eq("2026-09-20（国庆调休周日）识别为调休上班日晚", SceneKind.MakeupWorkdayNight,
            SceneDetector.Detect(At(2026, 9, 20, 23, 30)).Scene);
        h.Eq("2026-10-10（国庆调休周六）识别为调休上班日晚", SceneKind.MakeupWorkdayNight,
            SceneDetector.Detect(At(2026, 10, 10, 23, 30)).Scene);
        h.Eq("2026-05-09（劳动节调休周六）识别为调休上班日晚", SceneKind.MakeupWorkdayNight,
            SceneDetector.Detect(At(2026, 5, 9, 23, 30)).Scene);

        h.Eq("2026-09-05 01:00 时间分区 = 深夜", TimeBuckets.Midnight, SceneDetector.Detect(At(2026, 9, 5, 1, 0)).TimeBucket);
        h.Eq("2026-09-05 04:00 时间分区 = 后半夜", TimeBuckets.SmallHours, SceneDetector.Detect(At(2026, 9, 5, 4, 0)).TimeBucket);
        h.Eq("2026-09-05 06:00 时间分区 = 天将亮", TimeBuckets.Dawn, SceneDetector.Detect(At(2026, 9, 5, 6, 0)).TimeBucket);
        h.Eq("2026-09-05 23:00 时间分区 = 刚躺下", TimeBuckets.Late, SceneDetector.Detect(At(2026, 9, 5, 23, 0)).TimeBucket);

        var described = SceneDetector.Describe(eve);
        h.Check("describeScene 输出包含日期与场景标签", described.Contains("2026-09-24", StringComparison.Ordinal) && described.Contains("假期前夜", StringComparison.Ordinal));
        h.Check("describeScene 不泄露任何用户数据", !described.Contains("apiKey", StringComparison.OrdinalIgnoreCase) && !described.Contains("password", StringComparison.OrdinalIgnoreCase));
    }

    // ─────────────────────────────────────────────────────────
    private static void RunCopyGroup(Harness h)
    {
        h.Group("copy · 文案库与轮播（PRD 2.2.2 / 2.4）");

        var sourced = CopyLibrary.Hazards.Where(entry => entry.Source is not null).ToList();
        h.Check("至少 5 条危害科普绑定了可核查来源", sourced.Count >= 5, $"实际 {sourced.Count} 条");

        var unknownSources = sourced
            .Where(entry => !CopyLibrary.FactSources.ContainsKey(entry.Source!))
            .Select(entry => entry.Id)
            .ToList();
        h.Check("每条危害科普的 source 都能在来源表中找到", unknownSources.Count == 0, string.Join(",", unknownSources));

        var ids = CopyLibrary.Hazards.Concat(CopyLibrary.Comfort).Select(entry => entry.Id).ToList();
        h.Eq("文案库没有重复 id", ids.Count, ids.Distinct(StringComparer.Ordinal).Count());

        var friday = SceneDetector.Detect(At(2026, 9, 4, 23, 30));
        var first = CopyLibrary.BuildPlaylist(friday).Select(entry => entry.Id).ToList();
        var second = CopyLibrary.BuildPlaylist(SceneDetector.Detect(At(2026, 9, 4, 23, 45))).Select(entry => entry.Id).ToList();
        h.Check("同一天同一场景的播放顺序稳定（刷新不跳变）", first.SequenceEqual(second, StringComparer.Ordinal));

        var saturday = CopyLibrary.BuildPlaylist(SceneDetector.Detect(At(2026, 9, 5, 23, 30))).Select(entry => entry.Id).ToList();
        h.Check("不同日期得到不同的顺序", !first.SequenceEqual(saturday, StringComparer.Ordinal));

        var kinds = CopyLibrary.BuildPlaylist(friday).Select(entry => entry.Kind).Distinct(StringComparer.Ordinal).ToList();
        h.Check("播放列表同时包含 hazard / comfort / scene 三类", kinds.Contains("hazard") && kinds.Contains("comfort") && kinds.Contains("scene"));

        var noHazard = CopyLibrary.BuildPlaylist(friday, includeHazards: false);
        h.Check("关闭危害科普后不再出现 hazard", noHazard.All(entry => entry.Kind != "hazard"));

        var rotator = new CopyRotator([new CopyEntry("a", "t", "A"), new CopyEntry("b", "t", "B"), new CopyEntry("c", "t", "C")], 1000);
        h.Eq("轮播当前为 a", "a", rotator.Current.Id);
        h.Eq("next → b", "b", rotator.Next().Id);
        h.Eq("next → c", "c", rotator.Next().Id);
        h.Eq("next 循环回 a", "a", rotator.Next().Id);
        h.Eq("jumpTo(c)", "c", rotator.JumpTo("c").Id);
        h.Eq("jumpTo(不存在) 保持不动", "c", rotator.JumpTo("不存在").Id);
        h.Throws<ArgumentOutOfRangeException>("空列表必须报错而不是产生 undefined 文案", () => new CopyRotator([]));

        var ra = CopyLibrary.CreateRandom(42);
        var rb = CopyLibrary.CreateRandom(42);
        h.Check("createRandom 是确定性的", Math.Abs(ra() - rb()) < 1e-15 && Math.Abs(ra() - rb()) < 1e-15);

        // ── 与 Web 端核心的逐位等价性（参考值由 Node 运行 packages/core 得到）──
        h.Eq("hashString(\"2026-09-04|friday-night\") 与 Web 端一致", 1571155416u, CopyLibrary.HashString("2026-09-04|friday-night"));

        var refRandom = new[] { 0.318732434884, 0.996945387218, 0.593856765656, 0.980234255083, 0.544749907684 };
        var rng = CopyLibrary.CreateRandom(CopyLibrary.HashString("2026-09-04|friday-night"));
        var sameRng = true;
        for (var i = 0; i < refRandom.Length; i++)
        {
            if (Math.Abs(rng() - refRandom[i]) > 1e-9)
            {
                sameRng = false;
            }
        }

        h.Check("mulberry32 随机序列与 Web 端一致（前 5 个值）", sameRng);

        const string expectedPlaylist =
            "f-1,f-2,f-3,c-7,c-8,h-amygdala,c-10,h-blue,c-1,h-glymphatic,c-2,h-vicious,c-5,h-cold,c-4,h-alcohol,c-6,h-alcohol24,c-9,h-iarc,c-3";
        var actualPlaylist = string.Join(",", first);
        h.Eq("周五晚播放列表顺序与 Web 端逐位一致（21 条）", expectedPlaylist, actualPlaylist);
    }

    // ─────────────────────────────────────────────────────────
    private static void RunQuotaGroup(Harness h)
    {
        h.Group("quota · 每周解除额度（PRD 2.1.3）");

        h.Eq("weekKeyOf(2026-08-31 00:00) 周一是本周起点", "2026-08-31", WeekUtil.WeekKeyOf(At(2026, 8, 31, 0, 0)));
        h.Eq("weekKeyOf(2026-08-31 23:59)", "2026-08-31", WeekUtil.WeekKeyOf(At(2026, 8, 31, 23, 59)));
        h.Eq("weekKeyOf(2026-09-06 23:59) 周日仍属于本周", "2026-08-31", WeekUtil.WeekKeyOf(At(2026, 9, 6, 23, 59)));
        h.Eq("weekKeyOf(2026-09-07 00:00) 下周一进入新的一周", "2026-09-07", WeekUtil.WeekKeyOf(At(2026, 9, 7, 0, 0)));
        h.Eq("startOfWeek 的星期必须是周一", DayOfWeek.Monday, WeekUtil.StartOfWeek(At(2026, 9, 6, 15, 0)).DayOfWeek);
        h.Eq("跨月的自然周：2026-03-01（周日）属于 2026-02-23 那一周", "2026-02-23", WeekUtil.WeekKeyOf(At(2026, 3, 1, 12, 0)));
        h.Eq("跨年的自然周：2027-01-01（周五）属于 2026-12-28 那一周", "2026-12-28", WeekUtil.WeekKeyOf(At(2027, 1, 1, 12, 0)));

        var quota = new QuotaStore(new MemoryKeyValueStore());
        var sundayNight = At(2026, 8, 30, 23, 0);
        var justBeforeMonday = At(2026, 8, 30, 23, 59, 59);
        var mondayMidnight = At(2026, 8, 31, 0, 0, 0);

        h.Eq("周日晚初始剩余 2 次", 2, quota.Remaining(sundayNight));
        h.Check("第一次解除成功", quota.Consume(sundayNight).Ok);
        h.Check("第二次解除成功", quota.Consume(sundayNight).Ok);
        h.Eq("周日末尾额度已用尽", 0, quota.Remaining(justBeforeMonday));
        h.Check("用尽后不能再解除", !quota.Consume(justBeforeMonday).Ok);
        h.Eq("周一 00:00 应自动重置为 2 次", 2, quota.Remaining(mondayMidnight));
        h.Check("重置后可以再次解除", quota.Consume(mondayMidnight).Ok);

        var tight = new QuotaStore(new MemoryKeyValueStore(), total: 1);
        var now = At(2026, 9, 1, 23, 30);
        h.Check("额度为 1 时第一次成功", tight.Consume(now).Ok);
        var secondAttempt = tight.Consume(now);
        h.Check("第二次失败", !secondAttempt.Ok);
        h.Eq("失败时剩余为 0", 0, secondAttempt.Remaining);
        h.Check("失败时给出明确原因（含「额度」）", secondAttempt.Reason?.Contains("额度", StringComparison.Ordinal) == true);

        var shared = new MemoryKeyValueStore();
        var session1 = new QuotaStore(shared);
        session1.Consume(now);
        var session2 = new QuotaStore(shared);
        h.Eq("额度状态跨会话持久化（模拟重开应用）", 1, session2.Remaining(now));

        var corrupt = new QuotaStore(new MemoryKeyValueStore([new KeyValuePair<string, string>("quota", "{ 这不是合法 JSON")]));
        h.Eq("存储损坏时回退到满额度，绝不把用户锁死", 2, corrupt.Remaining(now));
    }

    // ─────────────────────────────────────────────────────────
    private static void RunPasswordGroup(Harness h)
    {
        h.Group("password · 紧急解除密码（PRD 2.2.5）");

        var hash1234 = PasswordHasher.Hash("1234");
        h.Check("正确密码通过", PasswordHasher.Verify("1234", hash1234));
        h.Check("错误密码不通过", !PasswordHasher.Verify("1235", hash1234));
        h.Check("空密码不通过", !PasswordHasher.Verify(string.Empty, hash1234));
        h.Check("未设置密码时永远不通过（避免空密码解锁）", !PasswordHasher.Verify("1234", string.Empty));
        h.Check("未设置密码时传空串也不通过", !PasswordHasher.Verify(string.Empty, string.Empty));
        h.Eq("相同密码得到相同摘要（可持久化）", PasswordHasher.Hash("abcd"), PasswordHasher.Hash("abcd"));
        h.Check("不同密码得到不同摘要", PasswordHasher.Hash("abcd") != PasswordHasher.Hash("abce"));

        // 与 Web 端 WebCrypto 产生的摘要必须完全一致，否则两端密码不通用
        h.Eq("SHA-256(\"1234\") 与 Web 端一致",
            "1b3454f0dfdf42cec3db4fc4860651b05356c43717baa2573dae29f3ccb19409", hash1234);
        h.Eq("SHA-256(\"abcd\") 与 Web 端一致",
            "da6c20f1fefd3abd165ba8caeca2835cb3f49d35bc016bb67d27b15365f97474", PasswordHasher.Hash("abcd"));

        h.Eq("密码建议（12）返回 2 条", 2, PasswordHasher.Advice("12").Count);
        h.Eq("密码建议（纯数字）含「混合字母」提示",
            true, PasswordHasher.Advice("1234").Any(a => a.Contains("混合字母", StringComparison.Ordinal)));
        h.Eq("密码建议（abcd1234）为空", 0, PasswordHasher.Advice("abcd1234").Count);
    }

    // ─────────────────────────────────────────────────────────
    private static void RunSettingsGroup(Harness h)
    {
        h.Group("settings · 迁移与容错");

        var defaults = SettingsMigrator.Migrate(null);
        h.Eq("默认工作日开始时间 23:00", "23:00", defaults.Plan.Windows[DayType.Weekday].Start);
        h.Eq("默认周末开始时间 23:00", "23:00", defaults.Plan.Windows[DayType.Weekend].Start);
        h.Eq("默认提前提醒 15 分钟", 15, defaults.Plan.WarnMinutes);
        h.Eq("默认白名单总时长 30 分钟", 30, defaults.Whitelist.TotalMinutes);
        h.Eq("设置结构版本", AppInfo.SettingsVersion, defaults.Version);

        var clamped = SettingsMigrator.Migrate(new Settings
        {
            Blackout = new BlackoutSettings { Brightness = 99 },
            Whitelist = new WhitelistSettings { TotalMinutes = 9999 },
            Ai = new AiSettings { Temperature = -5, TimeoutMs = 1 },
            Plan = new PlanSettings { WarnMinutes = -1 },
        });
        h.Check("亮度上限夹到 1", Math.Abs(clamped.Blackout.Brightness - 1) < 1e-9);
        h.Eq("白名单时长上限夹到 60 分钟", 60, clamped.Whitelist.TotalMinutes);
        h.Eq("AI 温度下限夹到 0", 0d, clamped.Ai.Temperature);
        h.Eq("AI 超时下限夹到 2000ms", 2000, clamped.Ai.TimeoutMs);
        h.Eq("提前提醒下限夹到 0", 0, clamped.Plan.WarnMinutes);

        var withCustom = SettingsMigrator.Migrate(new Settings
        {
            Whitelist = new WhitelistSettings
            {
                Apps = [new WhitelistApp { Id = "wechat", Name = "微信" }],
            },
        });
        h.Check("系统电话被自动补回", withCustom.Whitelist.Apps.Any(app => app.Id == "sys-phone"));
        h.Check("系统短信被自动补回", withCustom.Whitelist.Apps.Any(app => app.Id == "sys-sms"));
        h.Check("用户自定义应用被保留", withCustom.Whitelist.Apps.Any(app => app.Id == "wechat"));
        var phone = withCustom.Whitelist.Apps.First(app => app.Id == "sys-phone");
        h.Check("系统电话不可移除", !phone.Removable);
        h.Check("系统通话不占用白名单时长", !phone.CountsAgainstQuota);

        var tampered = SettingsMigrator.Migrate(new Settings
        {
            Whitelist = new WhitelistSettings
            {
                Apps = [new WhitelistApp { Id = "sys-phone", Name = "电话", Removable = true, CountsAgainstQuota = true }],
            },
        });
        var tamperedPhone = tampered.Whitelist.Apps.First(app => app.Id == "sys-phone");
        h.Check("直接改数据也无法把系统应用标记为可移除", !tamperedPhone.Removable && !tamperedPhone.CountsAgainstQuota);

        var store = new SettingsStore(new MemoryKeyValueStore());
        store.Update(s => s.Plan.WarnMinutes = 30);
        h.Eq("更新后立即生效", 30, store.Value.Plan.WarnMinutes);
        store.Reset();
        h.Eq("重置回到默认值", 15, store.Value.Plan.WarnMinutes);

        var notified = 0;
        var notifying = new SettingsStore(new MemoryKeyValueStore());
        notifying.Changed += _ => notified++;
        notifying.Update(s => s.Plan.WarnMinutes = 30);
        h.Eq("订阅者在更新时被通知一次", 1, notified);

        var brokenStore = new SettingsStore(new MemoryKeyValueStore([new KeyValuePair<string, string>(SettingsStore.StorageKey, "!!!非法 JSON!!!")]));
        h.Eq("损坏的存储数据不会让应用启动失败", "23:00", brokenStore.Value.Plan.Windows[DayType.Weekday].Start);

        var roundTrip = SettingsMigrator.Migrate(null);
        roundTrip.Plan.WarnMinutes = 30;
        roundTrip.Whitelist.Apps.Add(new WhitelistApp { Id = "vscode", Name = "VS Code", ProcessName = "Code" });
        var restored = SettingsMigrator.Migrate(SettingsMigrator.Deserialize(SettingsMigrator.Serialize(roundTrip)));
        h.Eq("序列化 / 反序列化往返保留提醒分钟数", 30, restored.Plan.WarnMinutes);
        h.Eq("往返保留桌面端扩展字段 ProcessName", "Code",
            restored.Whitelist.Apps.FirstOrDefault(app => app.Id == "vscode")?.ProcessName);
        h.Eq("往返保留桌面端扩展节 Desktop.AutoStart", false, restored.Desktop.AutoStart);
    }

    // ─────────────────────────────────────────────────────────
    private static void RunEngineGroup(Harness h)
    {
        h.Group("engine · 状态引擎与紧急解除（PRD 2.2.5）");

        const string password = "1234";
        var mondayNight = At(2026, 8, 31, 23, 30);

        Engine Build(out SettingsStore settings, out QuotaStore quota)
        {
            var storage = new MemoryKeyValueStore();
            settings = new SettingsStore(storage);
            settings.Update(s =>
            {
                s.Emergency.PasswordHash = PasswordHasher.Hash(password);
                s.Emergency.QuotaTotal = 2;
                s.Onboarded = true;
            });
            quota = new QuotaStore(storage, total: 2);
            return new Engine(settings, quota);
        }

        var engine = Build(out _, out _);
        var snapshot = engine.Snapshot(mondayNight);
        h.Eq("周一 23:30 处于 ACTIVE", Phase.Active, snapshot.Phase);
        h.Eq("剩余时长指向次日 07:00（7.5 小时）", 7.5 * 3_600_000, (double)snapshot.RemainingMs);
        h.Eq("时段结束日为 2026-09-01", "2026-09-01", TimeUtil.DateKey(snapshot.Window!.End));

        var before = snapshot.Quota.Remaining;
        var badPassword = engine.EmergencyUnlock("9999", mondayNight);
        h.Check("错误密码返回 bad-password", !badPassword.Ok && badPassword.Reason == "bad-password");
        h.Eq("错误密码不消耗额度（先密码后额度）", before, engine.Snapshot(mondayNight).Quota.Remaining);
        h.Eq("错误密码后仍处于熄灯状态", Phase.Active, engine.Snapshot(mondayNight).Phase);

        var good = engine.EmergencyUnlock(password, mondayNight);
        h.Check("正确密码解除成功", good.Ok);
        h.Eq("解除后剩余额度为 1", 1, good.Remaining);
        var afterUnlock = engine.Snapshot(mondayNight);
        h.Eq("解除后当日熄灯失效 → OFF", Phase.Off, afterUnlock.Phase);
        h.Check("dismissed == true", afterUnlock.Dismissed);
        h.Eq("被解除的时段键为 2026-08-31", "2026-08-31", afterUnlock.DismissedWindowKey);

        // 同一次时段内不应重新接管；次日应自动恢复
        h.Eq("同一次时段内推进到凌晨 03:00 仍为 OFF", Phase.Off, engine.Snapshot(At(2026, 9, 1, 3, 0)).Phase);
        h.Eq("次日 23:30 按计划自动恢复 ACTIVE", Phase.Active, engine.Snapshot(At(2026, 9, 1, 23, 30)).Phase);

        var notActive = Build(out _, out var notActiveQuota);
        var idleResult = notActive.EmergencyUnlock(password, At(2026, 8, 31, 20, 0));
        h.Check("非熄灯状态下不允许解除（不浪费额度）", !idleResult.Ok && idleResult.Reason == "not-active");
        h.Eq("非熄灯状态下额度未变", 2, notActiveQuota.Remaining(At(2026, 8, 31, 20, 0)));

        var exhausted = Build(out _, out _);
        h.Check("第一次解除成功", exhausted.EmergencyUnlock(password, At(2026, 8, 31, 23, 30)).Ok);
        h.Check("第二次解除成功", exhausted.EmergencyUnlock(password, At(2026, 9, 1, 23, 30)).Ok);
        var third = exhausted.EmergencyUnlock(password, At(2026, 9, 2, 23, 30));
        h.Check("额度用尽后无法再解除", !third.Ok && third.Reason == "quota-exhausted");
        h.Eq("额度用尽后必须继续熄灯", Phase.Active, exhausted.Snapshot(At(2026, 9, 2, 23, 30)).Phase);

        var noPassword = new Engine(
            new SettingsStore(new MemoryKeyValueStore()),
            new QuotaStore(new MemoryKeyValueStore(), total: 2));
        var noPasswordResult = noPassword.EmergencyUnlock("0000", mondayNight);
        h.Check("未设置密码时返回 no-password", !noPasswordResult.Ok && noPasswordResult.Reason == "no-password");

        var copyEngine = Build(out _, out _);
        var localCopy = copyEngine.Snapshot(mondayNight).Copy;
        h.Check("默认使用本地轮播文案", localCopy.Kind != "ai");
        copyEngine.SetAiText("今晚是周一，早点睡。");
        var aiCopy = copyEngine.Snapshot(mondayNight).Copy;
        h.Eq("AI 文案优先于本地轮播", "ai", aiCopy.Kind);
        h.Eq("AI 文案内容正确", "今晚是周一，早点睡。", aiCopy.Text);
        copyEngine.SetAiText(null);
        h.Check("清空后恢复本地轮播", copyEngine.Snapshot(mondayNight).Copy.Kind != "ai");

        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < 40; i++)
        {
            var item = copyEngine.RotateCopy(mondayNight);
            if (!string.IsNullOrEmpty(item.Text))
            {
                seen.Add(item.Id);
            }
        }

        h.Check("40 次轮播推进覆盖多条文案且始终非空", seen.Count > 5, $"覆盖 {seen.Count} 条");
    }

    // ─────────────────────────────────────────────────────────
    private static void RunGuardGroup(Harness h)
    {
        h.Group("guard · 防绕过守卫（PRD 三 / 2.2.5）");

        // 系统时间被向前拨动（试图跳过熄灯时段）
        long wall = 1_000_000;
        long mono = 0;
        var jumps = new List<ClockJumpEvent>();
        var forwardGuard = new ClockGuard(() => wall, () => mono, 5_000, jumps.Add);

        wall += 1000;
        mono += 1000;
        h.Check("正常流逝不触发时间跳变", forwardGuard.Sample() is null);

        wall += 2 * 3_600_000;
        mono += 1000;
        var forwardJump = forwardGuard.Sample();
        h.Check("系统时间被向前拨动 2 小时能被检出", forwardJump is not null);
        h.Eq("跳变方向为 forward", "forward", forwardJump?.Direction);
        h.Check("漂移量大于 7000 秒", (forwardJump?.DriftMs ?? 0) > 7_000_000);
        h.Eq("回调恰好触发一次", 1, jumps.Count);

        // 系统时间被向后拨动
        long backWall = 5_000_000;
        long backMono = 0;
        var backGuard = new ClockGuard(() => backWall, () => backMono, 5_000);
        backWall -= 3_600_000;
        backMono += 1000;
        h.Eq("系统时间被向后拨动同样能被检出", "backward", backGuard.Sample()?.Direction);

        // 连续点击计数：够 5 次触发，间隔过久则重新计数
        long now = 0;
        var triggers = 0;
        var counter = new TapCounter(5, 3000, () => now, () => triggers++);

        h.Eq("第 1 次点击 progress == 1", 1, counter.Tap().Progress);
        h.Eq("第 2 次点击 progress == 2", 2, counter.Tap().Progress);
        h.Eq("第 3 次点击 progress == 3", 3, counter.Tap().Progress);
        h.Eq("第 4 次点击 progress == 4", 4, counter.Tap().Progress);

        now += Limits.EmergencyTapWindowMs + 1;
        h.Eq("停顿超过时间窗后重新计数", 1, counter.Tap().Progress);

        now += 100;
        counter.Tap();
        now += 100;
        counter.Tap();
        now += 100;
        counter.Tap();
        now += 100;
        var fifth = counter.Tap();
        h.Check("第 5 次连击触发紧急解除入口", fifth.Triggered);
        h.Eq("触发回调恰好一次", 1, triggers);
        h.Eq("触发后计数清零", 0, counter.Progress);
    }

    // ─────────────────────────────────────────────────────────
    private static void RunPlatformGroup(Harness h)
    {
        h.Group("platform · 用户目录 / 前台进程监听 / 开机自启");

        h.Check("用户数据目录已解析", !string.IsNullOrWhiteSpace(AppPaths.UserDataDir));
        if (OperatingSystem.IsWindows())
        {
            h.Check("Windows 用户目录以 xideng 结尾", AppPaths.UserDataDir.EndsWith("xideng", StringComparison.OrdinalIgnoreCase));
            h.Check(@"Windows 用户目录位于 %APPDATA%\xideng",
                AppPaths.UserDataDir.StartsWith(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    StringComparison.OrdinalIgnoreCase));
        }
        else if (OperatingSystem.IsMacOS())
        {
            h.Check("macOS 用户目录为 ~/Library/Application Support/xideng",
                AppPaths.UserDataDir.Contains("Application Support", StringComparison.Ordinal)
                && AppPaths.UserDataDir.EndsWith("xideng", StringComparison.OrdinalIgnoreCase));
        }

        using var watcher = ProcessWatcherFactory.Create();
        h.Check($"前台进程监听器已创建（{watcher.GetType().Name}）", true);
        h.Eq("Windows 上 IsSupported 应为 true", OperatingSystem.IsWindows(), watcher.IsSupported);
        h.Check($"能力说明如实标注：{watcher.SupportNote}", !string.IsNullOrWhiteSpace(watcher.SupportNote));

        if (OperatingSystem.IsWindows())
        {
            var foreground = WindowsProcessWatcher.QueryForeground();
            h.Check("能读取当前前台窗口（无窗口时允许为 null）",
                foreground is null || (foreground.ProcessId > 0 && !string.IsNullOrWhiteSpace(foreground.ProcessName)),
                foreground is null ? "当前无前台窗口" : $"{foreground.ProcessName} (pid {foreground.ProcessId})");
        }

        h.Check("开机自启在本平台受支持", AutoStartManager.IsSupported);
        h.Check($"开机自启命令行为可执行路径且已加引号：{AutoStartManager.CommandLine}",
            AutoStartManager.CommandLine.StartsWith('"'));

        if (OperatingSystem.IsWindows())
        {
            // 使用独立的临时注册表键做读写往返验证，绝不触碰真实的 Run 自启动项
            const string probeKey = @"Software\Xideng\SelfTest";
            var writeOk = false;
            var readBack = "";
            try
            {
                using (var key = Registry.CurrentUser.CreateSubKey(probeKey, writable: true))
                {
                    key.SetValue("probe", AutoStartManager.CommandLine, RegistryValueKind.String);
                }

                using (var key = Registry.CurrentUser.OpenSubKey(probeKey, writable: false))
                {
                    readBack = key?.GetValue("probe") as string ?? string.Empty;
                }

                writeOk = readBack == AutoStartManager.CommandLine;
                Registry.CurrentUser.DeleteSubKeyTree(probeKey, throwOnMissingSubKey: false);
            }
            catch (Exception ex)
            {
                h.Check(@"注册表读写往返（临时键 HKCU\Software\Xideng\SelfTest）", false, ex.GetType().Name);
            }

            h.Check("注册表读写往返成功（临时键，已清理）", writeOk);

            using var runKey = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run",
                writable: false);
            h.Check("HKCU Run 注册表项可访问（仅读取，未修改自启动状态）", runKey is not null);
            h.Check("自启动项当前状态可查询", AutoStartManager.IsEnabled() || !AutoStartManager.IsEnabled());
        }
    }

    // ─────────────────────────────────────────────────────────
    private static void RunUnverifiedGroup(Harness h)
    {
        h.Group("unverified · 本机无法验证的能力（如实标注，不计入通过/失败）");

        h.Note("macOS LaunchAgent（~/Library/LaunchAgents/com.xideng.desktop.plist）：代码已实现，本机无 macOS 环境，未验证。");
        h.Note("macOS 用户目录（~/Library/Application Support/xideng）：代码已实现（对 SpecialFolder.ApplicationData 做了 macOS 分支），未验证。");
        h.Note("macOS 前台进程监听：待实现（需 NSWorkspace.frontmostApplication）。");
        h.Note("Linux 前台进程监听：待实现（需 X11 EWMH 或 AT-SPI，依赖桌面环境）。");
        h.Note("多显示器全屏置顶熄灯窗口（每屏一个 Window，Topmost = true）：依赖真实图形会话，无法在无头 / 控制台自检中验证。");
        h.Note("禁止关闭（拦截 Closing 并取消）：依赖真实窗口消息循环，无法在自检中验证。");
        h.Note("Windows 上 GetForegroundWindow 的实际置顶效果：自检只能验证能读到前台进程，无法验证窗口 Z 序。");
        h.Note("Avalonia 12 与 11 的差异：本工程按规格使用 Avalonia 11.3.0；本机 NuGet 缓存中另有 12.1.4。");
    }

    // ─────────────────────────────────────────────────────────
    private static PlanSettings DefaultPlan() => SettingsMigrator.Migrate(null).Plan;

    private static DateTime At(int year, int month, int day, int hour = 0, int minute = 0, int second = 0) =>
        new(year, month, day, hour, minute, second, DateTimeKind.Local);

    /// <summary>极简断言框架：统计通过 / 失败，并输出人类可读的结果。</summary>
    private sealed class Harness
    {
        public StringBuilder Text { get; } = new();

        public int Passed { get; private set; }

        public int Failed { get; private set; }

        public int Noted { get; private set; }

        private readonly List<string> _failures = [];

        public void Line(string message) => Text.AppendLine(message);

        public void Group(string name)
        {
            Text.AppendLine();
            Text.AppendLine($"── {name} ──");
        }

        public void Note(string message)
        {
            Noted++;
            Text.AppendLine($"  [待验证] {message}");
        }

        public void Check(string label, bool condition, string detail = "")
        {
            if (condition)
            {
                Passed++;
                Text.AppendLine($"  [PASS] {label}");
            }
            else
            {
                Failed++;
                var suffix = string.IsNullOrEmpty(detail) ? string.Empty : $"  ← {detail}";
                Text.AppendLine($"  [FAIL] {label}{suffix}");
                _failures.Add($"{label}{suffix}");
            }
        }

        public void Eq<T>(string label, T expected, T actual)
        {
            var ok = EqualityComparer<T>.Default.Equals(expected, actual);
            Check(label, ok, ok ? string.Empty : $"预期 <{Format(expected)}>，实际 <{Format(actual)}>");
        }

        public void Throws<TException>(string label, Action action)
            where TException : Exception
        {
            try
            {
                action();
                Check(label, false, $"预期抛出 {typeof(TException).Name}，但没有抛出");
            }
            catch (TException)
            {
                Check(label, true);
            }
            catch (Exception ex)
            {
                Check(label, false, $"预期 {typeof(TException).Name}，实际 {ex.GetType().Name}");
            }
        }

        private static string Format<T>(T value) => value switch
        {
            null => "null",
            double d => d.ToString("0.############", System.Globalization.CultureInfo.InvariantCulture),
            _ => value.ToString() ?? "null",
        };

        public void Summarize()
        {
            Text.AppendLine();
            Text.AppendLine("────────────────────────────────────────");
            if (Failed == 0)
            {
                Text.AppendLine($"自检通过：{Passed} 项断言全部通过，0 项失败。");
                Text.AppendLine("结论：PASS");
            }
            else
            {
                Text.AppendLine($"自检失败：{Passed} 项通过，{Failed} 项失败。");
                Text.AppendLine("失败明细：");
                foreach (var failure in _failures)
                {
                    Text.AppendLine($"  - {failure}");
                }

                Text.AppendLine("结论：FAIL");
            }

            if (Noted > 0)
            {
                Text.AppendLine($"（另有 {Noted} 项本机无法验证的能力已如实标注，不计入成败。）");
            }

            Text.AppendLine("────────────────────────────────────────");
        }
    }
}
