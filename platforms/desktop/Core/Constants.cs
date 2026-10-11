namespace Xideng.Desktop.Core;

/// <summary>
/// 熄灯早睡 · 全局常量（<c>packages/core/src/constants.js</c> 的 C# 移植）。
/// </summary>
public static class AppInfo
{
    public const string Name = "熄灯早睡";
    public const string NameEn = "LightsOut";
    public const string Slogan = "到点熄灯，把手机交还给睡眠";
    public const string Version = "1.0.0";
    public const int SettingsVersion = 1;
}

/// <summary>工作日 / 周末两套独立熄灯时段（PRD 2.1.1）。</summary>
public static class DayType
{
    public const string Weekday = "weekday";
    public const string Weekend = "weekend";

    public static readonly IReadOnlyDictionary<string, string> Labels = new Dictionary<string, string>
    {
        [Weekday] = "工作日",
        [Weekend] = "周末",
    };

    public static string Label(string dayType) => Labels.TryGetValue(dayType, out var v) ? v : dayType;
}

/// <summary>引擎相位（PRD 2.1.2 / 2.2.1）。</summary>
public static class Phase
{
    /// <summary>计划已关闭。</summary>
    public const string Off = "off";

    /// <summary>计划生效中，但距离熄灯开始尚早。</summary>
    public const string Idle = "idle";

    /// <summary>提前预告窗口内，全屏半透明弹窗 + 倒计时。</summary>
    public const string Warning = "warning";

    /// <summary>已进入强制熄灯模式。</summary>
    public const string Active = "active";
}

public static class Limits
{
    /// <summary>提前提醒可选时长（分钟），PRD 2.1.2。</summary>
    public static readonly int[] WarnMinuteOptions = [10, 15, 30];

    /// <summary>白名单总可用时长上限（分钟），PRD 2.2.3。</summary>
    public const int WhitelistTotalMinutesMax = 60;

    public const int WhitelistTotalMinutesMin = 5;

    /// <summary>每周紧急解除额度，PRD 2.1.3。</summary>
    public const int WeeklyQuotaTotal = 2;

    /// <summary>紧急解除触发：连续点击屏幕次数，PRD 2.2.5。</summary>
    public const int EmergencyTapCount = 5;

    /// <summary>连续点击的有效时间窗（毫秒）。</summary>
    public const long EmergencyTapWindowMs = 3000L;

    /// <summary>默认紧急解除密码；桌面端首次启动引导要求用户修改。</summary>
    public const string DefaultEmergencyPassword = "0000";

    /// <summary>核心动画时长，PRD 4.3：约 1.5 秒。</summary>
    public const int AnimationMs = 1500;

    /// <summary>黑屏界面文案轮播间隔。</summary>
    public const int CopyRotateMs = 12_000;

    public const int CopyFadeMs = 900;

    /// <summary>熄灯时段内检测到时间被篡改时的容忍阈值（毫秒），PRD 三。</summary>
    public const long ClockTamperToleranceMs = 5_000L;

    /// <summary>白名单应用运行时长的扣减精度（毫秒）。</summary>
    public const int WhitelistTickMs = 1_000;
}
