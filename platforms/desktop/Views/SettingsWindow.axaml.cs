using System.Diagnostics;
using System.IO;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Platform.Storage;
using Xideng.Desktop.Core;
using Xideng.Desktop.Platform;

namespace Xideng.Desktop.Views;

/// <summary>
/// 设置窗口：时段设置、周日晚开关、提前提醒、白名单管理、紧急解除密码、
/// 外观背景、开机自启（PRD 2.1 / 2.2.3 / 2.2.5 / 5.2 / 5.3）。
/// 全部控件在代码后置中直接读写，不使用绑定，以降低 XAML 编译期的风险面。
/// </summary>
public partial class SettingsWindow : Window
{
    private readonly DesktopCoordinator _coordinator;
    private bool _loading;

    /// <summary>内置背景选项：id → (显示名, avares 资源路径；"dark" 表示纯深色)。</summary>
    private static readonly (string Id, string Name, string? Uri)[] BackgroundOptions =
    [
        ("dark", "深色（默认）", null),
        // 背景图用 JPEG 而非 PNG：这些图全是 RGB 无透明通道、且是照片类内容，
        // PNG 存它们效率极低（最有代表性的一张 2.7 MB，转 JPEG 后 0.8 MB，观感无差别）。
        ("bg-aurora-1", "极光 · 水面倒影", "avares://Xideng.Desktop/assets/backgrounds/bg-aurora-1.jpg"),
        ("bg-aurora-2", "极光 · 蓝紫渐变", "avares://Xideng.Desktop/assets/backgrounds/bg-aurora-2.jpg"),
        ("bg-star-1", "星空 · 银河核心", "avares://Xideng.Desktop/assets/backgrounds/bg-star-1.jpg"),
        ("bg-star-2", "星空 · 银河横跨", "avares://Xideng.Desktop/assets/backgrounds/bg-star-2.jpg"),
        ("bg-star-3", "星空 · 密集繁星", "avares://Xideng.Desktop/assets/backgrounds/bg-star-3.jpg"),
        ("bg-firefly-1", "萤火虫 · 森林", "avares://Xideng.Desktop/assets/backgrounds/bg-firefly-1.jpg"),
    ];

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
        AppearanceCombo.ItemsSource = BackgroundOptions.Select(option => option.Name).ToList();

        SaveButton.Click += (_, _) => Save();
        TestBlackoutButton.Click += (_, _) => TestBlackout();
        ResetButton.Click += (_, _) => ResetToDefaults();
        OpenDataFolderButton.Click += (_, _) => OpenDataFolder();
        AddAppButton.Click += (_, _) => AddWhitelistAppFromPicker();
        BrowseAppButton.Click += (_, _) => AddWhitelistAppFromFile();
        RemoveAppButton.Click += (_, _) => RemoveSelectedApp();
        SetPasswordButton.Click += (_, _) => SetPassword();
        AutoStartCheck.IsCheckedChanged += (_, _) => ApplyAutoStart();
        AppearanceCombo.SelectionChanged += (_, _) => ApplyBackground();
        BrightnessSlider.PropertyChanged += (_, e) =>
        {
            if (e.Property == Avalonia.Controls.Primitives.RangeBase.ValueProperty)
            {
                BrightnessValueText.Text = Math.Round(BrightnessSlider.Value, 2).ToString("0.00");
            }
        };

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
        WeekdayStartWheel.SetValue(settings.Plan.Windows[DayType.Weekday].Start);
        WeekdayEndWheel.SetValue(settings.Plan.Windows[DayType.Weekday].End);
        WeekendStartWheel.SetValue(settings.Plan.Windows[DayType.Weekend].Start);
        WeekendEndWheel.SetValue(settings.Plan.Windows[DayType.Weekend].End);
        SundayAsWeekdayCheck.IsChecked = settings.Plan.SundayAsWeekday;

        var warnIndex = Array.IndexOf(Limits.WarnMinuteOptions, settings.Plan.WarnMinutes);
        WarnMinutesCombo.SelectedIndex = warnIndex >= 0 ? warnIndex : 1;

        var bgIndex = Array.FindIndex(BackgroundOptions, option => option.Id == settings.Appearance.BackgroundId);
        AppearanceCombo.SelectedIndex = bgIndex >= 0 ? bgIndex : 0;

        BrightnessSlider.Value = Math.Clamp(settings.Blackout.Brightness, 0.15, 1);
        BrightnessValueText.Text = Math.Round(BrightnessSlider.Value, 2).ToString("0.00");

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

        // 滚轮只产出合法的 HH:MM，但跨午夜 / 时长约束仍需校验（PRD 边界条件）
        var weekdayStart = WeekdayStartWheel.Current;
        var weekdayEnd = WeekdayEndWheel.Current;
        var weekendStart = WeekendStartWheel.Current;
        var weekendEnd = WeekendEndWheel.Current;

        problems.AddRange(ScheduleEngine.ValidateWindow(weekdayStart, weekdayEnd).Select(p => $"工作日：{p}"));
        problems.AddRange(ScheduleEngine.ValidateWindow(weekendStart, weekendEnd).Select(p => $"周末：{p}"));

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
            settings.Plan.Windows[DayType.Weekday] = new WindowConfig { Start = weekdayStart, End = weekdayEnd };
            settings.Plan.Windows[DayType.Weekend] = new WindowConfig { Start = weekendStart, End = weekendEnd };
            settings.Plan.SundayAsWeekday = SundayAsWeekdayCheck.IsChecked ?? true;

            var warnIndex = WarnMinutesCombo.SelectedIndex;
            settings.Plan.WarnMinutes = warnIndex >= 0 && warnIndex < Limits.WarnMinuteOptions.Length
                ? Limits.WarnMinuteOptions[warnIndex]
                : 15;

            var bgIndex = AppearanceCombo.SelectedIndex;
            settings.Appearance.BackgroundId = bgIndex >= 0 && bgIndex < BackgroundOptions.Length
                ? BackgroundOptions[bgIndex].Id
                : "dark";

            settings.Blackout.Brightness = Math.Clamp(BrightnessSlider.Value, 0.15, 1);
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

    // ── 外观 ──────────────────────────────────────────────

    /// <summary>
    /// 压暗层强度。背景图是照片类内容，亮部会把正文对比度吃光，
    /// 单靠图片本身在星空/极光这类高光背景下正文是不可读的。
    /// </summary>
    private static readonly IBrush ScrimOverImage = new SolidColorBrush(Color.Parse("#D9000000")); // 85% 黑

    private static readonly IBrush SolidBackdrop = new SolidColorBrush(Color.Parse("#111111"));

    /// <summary>根据当前选择的背景 id 即时预览窗口背景。</summary>
    private void ApplyBackground()
    {
        var index = AppearanceCombo.SelectedIndex;
        var uriText = index >= 0 && index < BackgroundOptions.Length ? BackgroundOptions[index].Uri : null;

        if (uriText is null)
        {
            // 纯深色：不需要压暗
            BackgroundLayer.Background = SolidBackdrop;
            BackgroundScrim.Background = Brushes.Transparent;
            return;
        }

        try
        {
            var uri = new Uri(uriText);
            using var stream = AssetLoader.Open(uri);
            var bitmap = new Bitmap(stream);
            BackgroundLayer.Background = new ImageBrush(bitmap)
            {
                Stretch = Stretch.UniformToFill,
                AlignmentX = AlignmentX.Center,
                AlignmentY = AlignmentY.Center,
            };
            BackgroundScrim.Background = ScrimOverImage;
        }
        catch (Exception)
        {
            // 资源缺失时回落到深色背景，不阻塞设置窗口
            BackgroundLayer.Background = SolidBackdrop;
            BackgroundScrim.Background = Brushes.Transparent;
        }
    }

    // ── 白名单 ──────────────────────────────────────────────

    /// <summary>当前用户自建白名单数量（系统电话/短信不计入上限）。</summary>
    private int UsedWhitelistSlots() =>
        _coordinator.Settings.Value.Whitelist.Apps.Count(app => app.Removable);

    /// <summary>校验名额是否可用；不可用则提示并返回 false。</summary>
    private bool EnsureWhitelistSlotAvailable()
    {
        if (UsedWhitelistSlots() < Limits.WhitelistAppCountMax)
        {
            return true;
        }

        StatusText.Foreground = new SolidColorBrush(Color.Parse("#C97A7A"));
        StatusText.Text = $"白名单最多 {Limits.WhitelistAppCountMax} 个用户应用，已达上限，请先移除一个再添加。";
        return false;
    }

    /// <summary>从"正在运行的应用"中点选（无需记进程名）。</summary>
    private async void AddWhitelistAppFromPicker()
    {
        if (!EnsureWhitelistSlotAvailable())
        {
            return;
        }

        var picker = new ProcessPickerWindow { UsedSlots = UsedWhitelistSlots() };
        var result = await picker.ShowDialog<ProcessPickResult?>(this);
        if (result is null)
        {
            return;
        }

        AddFromProcessPick(result);
    }

    /// <summary>直接浏览 .exe 文件添加（自动取进程名）。</summary>
    private async void AddWhitelistAppFromFile()
    {
        if (!EnsureWhitelistSlotAvailable())
        {
            return;
        }

        try
        {
            var files = await StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
            {
                Title = "选择要放行的程序（.exe）",
                AllowMultiple = false,
                FileTypeFilter =
                [
                    new FilePickerFileType("应用程序") { Patterns = ["*.exe"] },
                    new FilePickerFileType("所有文件") { Patterns = ["*"] },
                ],
            });

            if (files.Count == 0)
            {
                return;
            }

            var path = files[0].TryGetLocalPath();
            if (string.IsNullOrWhiteSpace(path))
            {
                StatusText.Foreground = new SolidColorBrush(Color.Parse("#C97A7A"));
                StatusText.Text = "无法读取所选文件的路径。";
                return;
            }

            var fileName = Path.GetFileNameWithoutExtension(path);
            AddFromProcessPick(new ProcessPickResult(fileName, fileName));
        }
        catch (Exception)
        {
            StatusText.Foreground = new SolidColorBrush(Color.Parse("#C97A7A"));
            StatusText.Text = "打开文件选择器失败，请改用「从运行中的应用选择」。";
        }
    }

    private void AddFromProcessPick(ProcessPickResult result)
    {
        if (!EnsureWhitelistSlotAvailable())
        {
            return;
        }

        var settings = _coordinator.Settings.Value;
        var exists = settings.Whitelist.Apps.Any(app =>
            string.Equals(app.ProcessName, result.ProcessName, StringComparison.OrdinalIgnoreCase));
        if (exists)
        {
            StatusText.Foreground = new SolidColorBrush(Color.Parse("#C97A7A"));
            StatusText.Text = $"「{result.Name}」已在白名单中。";
            return;
        }

        _coordinator.Settings.Update(current =>
        {
            current.Whitelist.Apps.Add(new WhitelistApp
            {
                Id = $"user-{Guid.NewGuid():N}"[..18],
                Name = result.Name,
                ProcessName = result.ProcessName,
                System = false,
                Removable = true,
                CountsAgainstQuota = true,
            });
        });

        LoadFromSettings();
        StatusText.Foreground = new SolidColorBrush(Color.Parse("#9AD19A"));
        StatusText.Text = $"已添加白名单应用：{result.Name}（进程 {result.ProcessName}）。";
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
