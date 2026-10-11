using System.Globalization;
using System.Text.Json.Serialization;

namespace Xideng.Desktop.Core;

/// <summary>单个熄灯时段（PRD 2.1.1）。</summary>
public sealed class WindowConfig
{
    public string Start { get; set; } = "23:00";

    public string End { get; set; } = "07:00";

    public WindowConfig Clone() => new() { Start = Start, End = End };
}

/// <summary>睡眠计划（PRD 2.1）。</summary>
public sealed class PlanSettings
{
    public bool Enabled { get; set; } = true;

    /// <summary>键为 <see cref="DayType.Weekday"/> / <see cref="DayType.Weekend"/>。</summary>
    public Dictionary<string, WindowConfig> Windows { get; set; } = new(StringComparer.Ordinal)
    {
        [DayType.Weekday] = new WindowConfig { Start = "23:00", End = "07:00" },
        [DayType.Weekend] = new WindowConfig { Start = "23:00", End = "07:00" },
    };

    public int WarnMinutes { get; set; } = 15;
}

/// <summary>黑屏界面表现（PRD 4.4）。</summary>
public sealed class BlackoutSettings
{
    public double CopyIntervalSec { get; set; } = 12;

    /// <summary>文字亮度，0-1，对应 PRD 4.4"亮度适配夜间环境，不刺眼"。</summary>
    public double Brightness { get; set; } = 0.62;
}

/// <summary>白名单应用条目（PRD 2.2.3）。</summary>
public sealed class WhitelistApp
{
    public string Id { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public bool System { get; set; }

    public bool Removable { get; set; } = true;

    public bool CountsAgainstQuota { get; set; } = true;

    public string Uri { get; set; } = string.Empty;

    public string Url { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    /// <summary>
    /// 桌面端扩展字段：该应用的可执行进程名（不含 .exe，比较时忽略大小写）。
    /// 用于 <c>ProcessWatcher</c> 判定"前台焦点是否落在白名单应用上"。
    /// 核心 Web 版没有这个字段，因此缺省为空字符串。
    /// </summary>
    public string ProcessName { get; set; } = string.Empty;

    public WhitelistApp Clone() => new()
    {
        Id = Id,
        Name = Name,
        System = System,
        Removable = Removable,
        CountsAgainstQuota = CountsAgainstQuota,
        Uri = Uri,
        Url = Url,
        Description = Description,
        ProcessName = ProcessName,
    };
}

public sealed class WhitelistSettings
{
    public int TotalMinutes { get; set; } = 30;

    public List<WhitelistApp> Apps { get; set; } = Settings.SystemWhitelistApps();
}

/// <summary>助眠音频（PRD 2.3）。</summary>
public sealed class AudioSettings
{
    public string Preset { get; set; } = "rain";

    public double Volume { get; set; } = 0.6;

    /// <summary>0 表示"持续播放至熄灯结束"。</summary>
    public int DurationMinutes { get; set; } = 30;

    public bool AutoPlay { get; set; }
}

/// <summary>AI 场景化文案（PRD 2.4）。<c>ApiKey</c> 仅保存在用户本机，绝不上传。</summary>
public sealed class AiSettings
{
    public bool Enabled { get; set; }

    public string BaseUrl { get; set; } = "https://api.openai.com/v1";

    public string Model { get; set; } = "gpt-4o-mini";

    public string ApiKey { get; set; } = string.Empty;

    public double Temperature { get; set; } = 0.9;

    public int TimeoutMs { get; set; } = 12_000;
}

/// <summary>紧急解除（PRD 2.1.3 / 2.2.5）。</summary>
public sealed class EmergencySettings
{
    /// <summary>SHA-256 十六进制摘要；空字符串表示尚未设置。</summary>
    public string PasswordHash { get; set; } = string.Empty;

    public int QuotaTotal { get; set; } = Limits.WeeklyQuotaTotal;
}

/// <summary>防绕过（PRD 三）。</summary>
public sealed class GuardSettings
{
    /// <summary>熄灯时段内离开时立即重新接管。</summary>
    public bool ReassertOnVisible { get; set; } = true;

    /// <summary>检测系统时间跳变。</summary>
    public bool DetectClockTamper { get; set; } = true;

    /// <summary>保持窗口置顶并周期性重申 Topmost。</summary>
    public bool ReassertTopmost { get; set; } = true;
}

/// <summary>
/// 桌面端专属设置（PRD 5.2 / 5.3）。核心 Web 版没有这一节，
/// 放在独立的 <c>desktop</c> 段里，避免与核心设置结构混淆。
/// </summary>
public sealed class DesktopSettings
{
    /// <summary>开机自启动（PRD 5.2「开机自启动权限」/ 5.3「开机自启动权限」）。</summary>
    public bool AutoStart { get; set; }

    /// <summary>启用前台进程监听（PRD 5.2「程序运行监听权限」/ 5.3「应用运行监听权限」）。</summary>
    public bool ProcessWatch { get; set; } = true;

    /// <summary>前台进程轮询间隔（毫秒）。</summary>
    public int ProcessWatchIntervalMs { get; set; } = 700;

    /// <summary>把"非白名单应用抢到焦点"记为一道违规（PRD 三、防绕过）。</summary>
    public bool RecordFocusViolation { get; set; } = true;
}

/// <summary>完整设置对象。字段与 <c>packages/core/src/constants.js#DEFAULT_SETTINGS</c> 一一对应。</summary>
public sealed class Settings
{
    public int Version { get; set; } = AppInfo.SettingsVersion;

    public PlanSettings Plan { get; set; } = new();

    public BlackoutSettings Blackout { get; set; } = new();

    public WhitelistSettings Whitelist { get; set; } = new();

    public AudioSettings Audio { get; set; } = new();

    public AiSettings Ai { get; set; } = new();

    public EmergencySettings Emergency { get; set; } = new();

    public GuardSettings Guard { get; set; } = new();

    /// <summary>桌面端扩展（不在核心 schema 中）。</summary>
    public DesktopSettings Desktop { get; set; } = new();

    public bool Onboarded { get; set; }

    /// <summary>系统自带、默认加入白名单且不可移除的应用（PRD 2.2.3）。</summary>
    public static List<WhitelistApp> SystemWhitelistApps() =>
    [
        new WhitelistApp
        {
            Id = "sys-phone",
            Name = "电话",
            System = true,
            Removable = false,
            CountsAgainstQuota = false,
            Uri = "tel:",
            Description = "系统通话，不受熄灯限制，且不消耗白名单时长",
            ProcessName = "Phone",
        },
        new WhitelistApp
        {
            Id = "sys-sms",
            Name = "短信",
            System = true,
            Removable = false,
            CountsAgainstQuota = false,
            Uri = "sms:",
            Description = "系统短信，不受熄灯限制，且不消耗白名单时长",
            ProcessName = "Messages",
        },
    ];

    public Settings Clone() => new()
    {
        Version = Version,
        Plan = new PlanSettings
        {
            Enabled = Plan.Enabled,
            WarnMinutes = Plan.WarnMinutes,
            Windows = Plan.Windows.ToDictionary(
                pair => pair.Key,
                pair => pair.Value.Clone(),
                StringComparer.Ordinal),
        },
        Blackout = new BlackoutSettings { CopyIntervalSec = Blackout.CopyIntervalSec, Brightness = Blackout.Brightness },
        Whitelist = new WhitelistSettings
        {
            TotalMinutes = Whitelist.TotalMinutes,
            Apps = Whitelist.Apps.Select(app => app.Clone()).ToList(),
        },
        Audio = new AudioSettings
        {
            Preset = Audio.Preset,
            Volume = Audio.Volume,
            DurationMinutes = Audio.DurationMinutes,
            AutoPlay = Audio.AutoPlay,
        },
        Ai = new AiSettings
        {
            Enabled = Ai.Enabled,
            BaseUrl = Ai.BaseUrl,
            Model = Ai.Model,
            ApiKey = Ai.ApiKey,
            Temperature = Ai.Temperature,
            TimeoutMs = Ai.TimeoutMs,
        },
        Emergency = new EmergencySettings { PasswordHash = Emergency.PasswordHash, QuotaTotal = Emergency.QuotaTotal },
        Guard = new GuardSettings
        {
            ReassertOnVisible = Guard.ReassertOnVisible,
            DetectClockTamper = Guard.DetectClockTamper,
            ReassertTopmost = Guard.ReassertTopmost,
        },
        Desktop = new DesktopSettings
        {
            AutoStart = Desktop.AutoStart,
            ProcessWatch = Desktop.ProcessWatch,
            ProcessWatchIntervalMs = Desktop.ProcessWatchIntervalMs,
            RecordFocusViolation = Desktop.RecordFocusViolation,
        },
        Onboarded = Onboarded,
    };
}

/// <summary>
/// 设置迁移与容错（对应 <c>packages/core/src/settings.js#migrateSettings</c>）。
/// 目标是"任何字段缺失、类型错误、版本过期都能收敛到合法状态"，而不是把问题抛给 UI。
/// </summary>
public static class SettingsMigrator
{
    public static Settings Migrate(Settings? raw)
    {
        var s = raw ?? new Settings();

        s.Version = AppInfo.SettingsVersion;

        // --- plan ---
        s.Plan ??= new PlanSettings();
        s.Plan.Windows ??= new Dictionary<string, WindowConfig>(StringComparer.Ordinal);
        foreach (var dayType in new[] { DayType.Weekday, DayType.Weekend })
        {
            if (!s.Plan.Windows.TryGetValue(dayType, out var window) || window is null)
            {
                s.Plan.Windows[dayType] = new WindowConfig { Start = "23:00", End = "07:00" };
            }
            else
            {
                if (string.IsNullOrEmpty(window.Start))
                {
                    window.Start = "23:00";
                }

                if (string.IsNullOrEmpty(window.End))
                {
                    window.End = "07:00";
                }
            }
        }

        s.Plan.WarnMinutes = ClampInt(s.Plan.WarnMinutes, 0, 120, 15);

        // --- blackout ---
        s.Blackout ??= new BlackoutSettings();
        s.Blackout.Brightness = ClampDouble(s.Blackout.Brightness, 0.15, 1, 0.62);
        s.Blackout.CopyIntervalSec = ClampDouble(s.Blackout.CopyIntervalSec, 5, 120, 12);

        // --- whitelist ---
        s.Whitelist ??= new WhitelistSettings();
        s.Whitelist.TotalMinutes = ClampInt(
            s.Whitelist.TotalMinutes,
            Limits.WhitelistTotalMinutesMin,
            Limits.WhitelistTotalMinutesMax,
            30);

        s.Whitelist.Apps ??= [];
        s.Whitelist.Apps = s.Whitelist.Apps
            .Where(app => app is not null && !string.IsNullOrEmpty(app.Id) && !string.IsNullOrEmpty(app.Name))
            .Select(app => new WhitelistApp
            {
                Id = app.Id,
                Name = app.Name,
                System = app.System,
                Removable = app.Removable,
                CountsAgainstQuota = app.CountsAgainstQuota,
                Uri = app.Uri ?? string.Empty,
                Url = app.Url ?? string.Empty,
                Description = app.Description ?? string.Empty,
                ProcessName = app.ProcessName ?? string.Empty,
            })
            .ToList();

        // 系统应用必须始终在列且不可移除（PRD 2.2.3）
        foreach (var systemApp in Settings.SystemWhitelistApps())
        {
            var existing = s.Whitelist.Apps.FirstOrDefault(app => app.Id == systemApp.Id);
            if (existing is null)
            {
                s.Whitelist.Apps.Insert(0, systemApp);
            }
            else
            {
                existing.System = true;
                existing.Removable = false;
                existing.CountsAgainstQuota = false;
                if (string.IsNullOrEmpty(existing.Name))
                {
                    existing.Name = systemApp.Name;
                }
            }
        }

        // --- audio ---
        s.Audio ??= new AudioSettings();
        s.Audio.Preset = string.IsNullOrEmpty(s.Audio.Preset) ? "rain" : s.Audio.Preset;
        s.Audio.Volume = ClampDouble(s.Audio.Volume, 0, 1, 0.6);
        s.Audio.DurationMinutes = ClampInt(s.Audio.DurationMinutes, 0, 600, 30);

        // --- ai ---
        s.Ai ??= new AiSettings();
        s.Ai.ApiKey ??= string.Empty;
        s.Ai.BaseUrl = string.IsNullOrEmpty(s.Ai.BaseUrl) ? "https://api.openai.com/v1" : s.Ai.BaseUrl;
        s.Ai.Model = string.IsNullOrEmpty(s.Ai.Model) ? "gpt-4o-mini" : s.Ai.Model;
        s.Ai.Temperature = ClampDouble(s.Ai.Temperature, 0, 2, 0.9);
        s.Ai.TimeoutMs = ClampInt(s.Ai.TimeoutMs, 2000, 60_000, 12_000);

        // --- emergency ---
        s.Emergency ??= new EmergencySettings();
        s.Emergency.PasswordHash ??= string.Empty;
        s.Emergency.QuotaTotal = ClampInt(s.Emergency.QuotaTotal, 0, 14, Limits.WeeklyQuotaTotal);

        // --- guard ---
        s.Guard ??= new GuardSettings();

        // --- desktop 扩展 ---
        s.Desktop ??= new DesktopSettings();
        s.Desktop.ProcessWatchIntervalMs = ClampInt(s.Desktop.ProcessWatchIntervalMs, 200, 10_000, 700);

        return s;
    }

    private static int ClampInt(int value, int min, int max, int fallback)
    {
        // C# 的 int 不存在 NaN；JSON 中的非法数值会让整份设置反序列化失败并回落到默认值，
        // 因此这里只需夹取区间。fallback 保留在签名中是为了与 JS 的 clampNumber 语义一一对应。
        _ = fallback;
        return Math.Clamp(value, min, max);
    }

    private static double ClampDouble(double value, double min, double max, double fallback)
    {
        if (double.IsNaN(value) || double.IsInfinity(value))
        {
            return fallback;
        }

        return Math.Clamp(value, min, max);
    }

    /// <summary>把对象序列化为规范 JSON（camelCase，与 Web 端存储形状一致）。</summary>
    public static string Serialize(Settings settings) =>
        System.Text.Json.JsonSerializer.Serialize(settings, SettingsJson.Options);

    public static Settings? Deserialize(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            return System.Text.Json.JsonSerializer.Deserialize<Settings>(json, SettingsJson.Options);
        }
        catch (System.Text.Json.JsonException)
        {
            // 数据损坏 → 回落默认值，保证应用始终能启动
            return null;
        }
    }
}

/// <summary>统一的 JSON 序列化选项。</summary>
public static class SettingsJson
{
    public static readonly System.Text.Json.JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        WriteIndented = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };
}
