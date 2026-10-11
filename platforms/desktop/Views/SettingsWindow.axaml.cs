using System.Diagnostics;
using Avalonia.Controls;
using Avalonia.Media;
using Xideng.Desktop.Core;
using Xideng.Desktop.Platform;

namespace Xideng.Desktop.Views;

/// <summary>
/// 设置窗口：时段设置、提前提醒、白名单管理、紧急解除密码、开机自启（PRD 2.1 / 2.2.3 / 2.2.5 / 5.2 / 5.3）。
/// 全部控件在代码后置中直接读写，不使用绑定，以降低 XAML 编译期的风险面。
/// </summary>
public partial class SettingsWindow : Window
{
    private readonly DesktopCoordinator _coordinator;
    private bool _loading;

    /// <summary>供 XAML 设计器 / 加载器使用。</summary>
    public SettingsWindow()
        : this(new DesktopCoordinator())
    {
    }

    public SettingsWindow(DesktopCoordinator coordinator)
    {
        _coordinator = coordinator;
        InitializeComponent();

        WarnMinutesCombo.ItemsSource = Limits.WarnMinuteOptions.Select(minutes => $"{minutes} 分钟").ToList();

        SaveButton.Click += (_, _) => Save();
        TestBlackoutButton.Click += (_, _) => TestBlackout();
        ResetButton.Click += (_, _) => ResetToDefaults();
        OpenDataFolderButton.Click += (_, _) => OpenDataFolder();
        AddAppButton.Click += (_, _) => AddWhitelistApp();
        RemoveAppButton.Click += (_, _) => RemoveSelectedApp();
        SetPasswordButton.Click += (_, _) => SetPassword();
        AutoStartCheck.IsCheckedChanged += (_, _) => ApplyAutoStart();

        _coordinator.Updated += _ => RefreshLiveStatus();
        _coordinator.Notice += message => StatusText.Text = message;

        LoadFromSettings();
        RefreshLiveStatus();
    }

    // ── 读取 / 写入 ─────────────────────────────────────────

    private void LoadFromSettings()
    {
        _loading = true;
        var settings = _coordinator.Settings.Value;

        PlanEnabledCheck.IsChecked = settings.Plan.Enabled;
        WeekdayStartBox.Text = settings.Plan.Windows[DayType.Weekday].Start;
        WeekdayEndBox.Text = settings.Plan.Windows[DayType.Weekday].End;
        WeekendStartBox.Text = settings.Plan.Windows[DayType.Weekend].Start;
        WeekendEndBox.Text = settings.Plan.Windows[DayType.Weekend].End;

        var warnIndex = Array.IndexOf(Limits.WarnMinuteOptions, settings.Plan.WarnMinutes);
        WarnMinutesCombo.SelectedIndex = warnIndex >= 0 ? warnIndex : 1;

        WhitelistMinutesBox.Text = settings.Whitelist.TotalMinutes.ToString(System.Globalization.CultureInfo.InvariantCulture);
        ProcessWatchCheck.IsChecked = settings.Desktop.ProcessWatch;
        AutoStartCheck.IsChecked = AutoStartManager.IsEnabled();

        PasswordStatusText.Text = string.IsNullOrEmpty(settings.Emergency.PasswordHash)
            ? "尚未设置密码（未设置时无法紧急解除）"
            : "已设置密码";

        PlatformNoteText.Text =
            $"用户数据目录：{AppPaths.UserDataDir}\n" +
            $"开机自启：{AutoStartManager.SupportNote}\n" +
            $"前台进程监听：{_coordinator.ProcessWatcher.SupportNote}";

        FooterText.Text =
            $"版本 {AppInfo.Version} · 设置结构版本 {AppInfo.SettingsVersion} · 所有设置仅保存在本机，不上传。" +
            "紧急解除密码使用 SHA-256 摘要存储，与 Web 端摘要完全一致。";

        WhitelistListBox.ItemsSource = settings.Whitelist.Apps
            .Select(app => FormatApp(app))
            .ToList();

        _loading = false;
    }

    private static string FormatApp(WhitelistApp app)
    {
        var process = string.IsNullOrWhiteSpace(app.ProcessName) ? "未绑定进程" : app.ProcessName;
        var quota = app.CountsAgainstQuota ? "占用时长" : "不占用时长";
        var locked = app.Removable ? string.Empty : " · 不可移除";
        return $"{app.Name}（进程：{process}）· {quota}{locked}";
    }

    private void Save()
    {
        var problems = new List<string>();

        if (!TimeUtil.TryToMinutes(WeekdayStartBox.Text, out _)) problems.Add("工作日开始时间格式应为 HH:MM");
        if (!TimeUtil.TryToMinutes(WeekdayEndBox.Text, out _)) problems.Add("工作日结束时间格式应为 HH:MM");
        if (!TimeUtil.TryToMinutes(WeekendStartBox.Text, out _)) problems.Add("周末开始时间格式应为 HH:MM");
        if (!TimeUtil.TryToMinutes(WeekendEndBox.Text, out _)) problems.Add("周末结束时间格式应为 HH:MM");

        if (problems.Count == 0)
        {
            problems.AddRange(ScheduleEngine.ValidateWindow(WeekdayStartBox.Text, WeekdayEndBox.Text).Select(p => $"工作日：{p}"));
            problems.AddRange(ScheduleEngine.ValidateWindow(WeekendStartBox.Text, WeekendEndBox.Text).Select(p => $"周末：{p}"));
        }

        if (!int.TryParse(WhitelistMinutesBox.Text, out var whitelistMinutes))
        {
            problems.Add("白名单总时长必须是数字");
        }

        if (problems.Count > 0)
        {
            StatusText.Foreground = new SolidColorBrush(Color.Parse("#C97A7A"));
            StatusText.Text = "保存失败：" + string.Join("；", problems);
            return;
        }

        _coordinator.Settings.Update(settings =>
        {
            settings.Plan.Enabled = PlanEnabledCheck.IsChecked ?? false;
            settings.Plan.Windows[DayType.Weekday] = new WindowConfig { Start = WeekdayStartBox.Text!.Trim(), End = WeekdayEndBox.Text!.Trim() };
            settings.Plan.Windows[DayType.Weekend] = new WindowConfig { Start = WeekendStartBox.Text!.Trim(), End = WeekendEndBox.Text!.Trim() };

            var warnIndex = WarnMinutesCombo.SelectedIndex;
            settings.Plan.WarnMinutes = warnIndex >= 0 && warnIndex < Limits.WarnMinuteOptions.Length
                ? Limits.WarnMinuteOptions[warnIndex]
                : 15;

            settings.Whitelist.TotalMinutes = Math.Clamp(whitelistMinutes, Limits.WhitelistTotalMinutesMin, Limits.WhitelistTotalMinutesMax);
            settings.Desktop.ProcessWatch = ProcessWatchCheck.IsChecked ?? false;
            settings.Desktop.AutoStart = AutoStartCheck.IsChecked ?? false;
            settings.Emergency.QuotaTotal = settings.Emergency.QuotaTotal;
        });

        _coordinator.Tick();

        StatusText.Foreground = new SolidColorBrush(Color.Parse("#9AD19A"));
        StatusText.Text = $"设置已保存（{DateTime.Now:HH:mm:ss}）。";
        LoadFromSettings();
    }

    private void ResetToDefaults()
    {
        _coordinator.Settings.Reset();
        _coordinator.Tick();
        LoadFromSettings();
        StatusText.Foreground = new SolidColorBrush(Color.Parse("#9AD19A"));
        StatusText.Text = "已恢复默认设置。";
    }

    // ── 白名单 ──────────────────────────────────────────────

    private void AddWhitelistApp()
    {
        var name = (NewAppNameBox.Text ?? string.Empty).Trim();
        var process = (NewAppProcessBox.Text ?? string.Empty).Trim();

        if (string.IsNullOrEmpty(name))
        {
            StatusText.Foreground = new SolidColorBrush(Color.Parse("#C97A7A"));
            StatusText.Text = "请填写应用名称。";
            return;
        }

        _coordinator.Settings.Update(settings =>
        {
            settings.Whitelist.Apps.Add(new WhitelistApp
            {
                Id = $"user-{Guid.NewGuid():N}"[..18],
                Name = name,
                ProcessName = process,
                System = false,
                Removable = true,
                CountsAgainstQuota = true,
            });
        });

        NewAppNameBox.Text = string.Empty;
        NewAppProcessBox.Text = string.Empty;
        LoadFromSettings();
        StatusText.Foreground = new SolidColorBrush(Color.Parse("#9AD19A"));
        StatusText.Text = $"已添加白名单应用：{name}。";
    }

    private void RemoveSelectedApp()
    {
        var index = WhitelistListBox.SelectedIndex;
        if (index < 0)
        {
            StatusText.Foreground = new SolidColorBrush(Color.Parse("#C97A7A"));
            StatusText.Text = "请先选择要移除的应用。";
            return;
        }

        var settings = _coordinator.Settings.Value;
        if (index >= settings.Whitelist.Apps.Count)
        {
            return;
        }

        var target = settings.Whitelist.Apps[index];
        if (!target.Removable)
        {
            StatusText.Foreground = new SolidColorBrush(Color.Parse("#C97A7A"));
            StatusText.Text = $"{target.Name} 是系统应用，不可移除（PRD 2.2.3）。";
            return;
        }

        _coordinator.Settings.Update(current =>
        {
            var found = current.Whitelist.Apps.FirstOrDefault(app => app.Id == target.Id);
            if (found is not null)
            {
                current.Whitelist.Apps.Remove(found);
            }
        });

        LoadFromSettings();
        StatusText.Foreground = new SolidColorBrush(Color.Parse("#9AD19A"));
        StatusText.Text = $"已移除白名单应用：{target.Name}。";
    }

    // ── 密码 ────────────────────────────────────────────────

    private void SetPassword()
    {
        var password = PasswordBox.Text ?? string.Empty;
        var advice = PasswordHasher.Advice(password);
        if (advice.Count > 0)
        {
            StatusText.Foreground = new SolidColorBrush(Color.Parse("#C97A7A"));
            StatusText.Text = "密码不符合要求：" + string.Join("；", advice);
            return;
        }

        _coordinator.Settings.Update(settings => settings.Emergency.PasswordHash = PasswordHasher.Hash(password));
        PasswordBox.Text = string.Empty;
        LoadFromSettings();
        StatusText.Foreground = new SolidColorBrush(Color.Parse("#9AD19A"));
        StatusText.Text = "紧急解除密码已更新（仅本机保存，SHA-256 摘要与 Web 端一致）。";
    }

    // ── 开机自启 ────────────────────────────────────────────

    private void ApplyAutoStart()
    {
        if (_loading)
        {
            return;
        }

        var wanted = AutoStartCheck.IsChecked ?? false;
        var ok = AutoStartManager.SetEnabled(wanted, out var message);

        StatusText.Foreground = new SolidColorBrush(Color.Parse(ok ? "#9AD19A" : "#C97A7A"));
        StatusText.Text = message;

        if (!ok)
        {
            _loading = true;
            AutoStartCheck.IsChecked = AutoStartManager.IsEnabled();
            _loading = false;
        }
    }

    // ── 其它动作 ────────────────────────────────────────────

    private void TestBlackout()
    {
        _coordinator.StartBlackoutPreview(TimeSpan.FromSeconds(12));
        StatusText.Foreground = new SolidColorBrush(Color.Parse("#9AD19A"));
        StatusText.Text = "已开始熄灯窗口预览（12 秒）。窗口为全屏置顶，连续点击 5 次可触发紧急解除入口。";
    }

    private void OpenDataFolder()
    {
        try
        {
            AppPaths.EnsureUserDataDir();
            Process.Start(new ProcessStartInfo
            {
                FileName = AppPaths.UserDataDir,
                UseShellExecute = true,
            });
        }
        catch (Exception ex)
        {
            StatusText.Foreground = new SolidColorBrush(Color.Parse("#C97A7A"));
            StatusText.Text = $"打开数据目录失败：{ex.GetType().Name}";
        }
    }

    private void RefreshLiveStatus()
    {
        var snapshot = _coordinator.Current;
        var phaseLabel = snapshot.Phase switch
        {
            Core.Phase.Active => "熄灯中",
            Core.Phase.Warning => "即将熄灯（预告中）",
            Core.Phase.Idle => "计划生效，未到熄灯时间",
            Core.Phase.Off => "计划关闭或已解除",
            _ => snapshot.Phase,
        };

        var remaining = snapshot.Phase == Core.Phase.Active
            ? $"剩余 {TimeUtil.FormatDurationCn(snapshot.RemainingMs)}"
            : snapshot.Window is not null
                ? $"下次熄灯 {TimeUtil.FormatClock(snapshot.Window.Start, seconds: false)}"
                : "无后续时段";

        var violations = _coordinator.RecentViolations;
        ViolationText.Text = violations.Count == 0
            ? "当前状态：" + phaseLabel + " · " + remaining + " · 本次启动暂无违规记录。"
            : $"当前状态：{phaseLabel} · {remaining} · 违规记录 {violations.Count} 条，最近一条：{violations[0]}";
    }
}
