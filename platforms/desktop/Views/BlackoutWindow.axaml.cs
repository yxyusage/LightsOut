using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;
using Avalonia.Platform;
using Avalonia.Threading;
using Xideng.Desktop.Core;
using Xideng.Desktop.Platform;

namespace Xideng.Desktop.Views;

/// <summary>
/// 强制熄灯全屏窗口（PRD 2.2.1 / 2.2.2）。
///
/// 这是桌面端相对 Web 端唯一的<b>实质能力优势</b>，因此务必做实：
/// <list type="bullet">
///   <item>无边框、覆盖整个屏幕、<c>Topmost = true</c>；</item>
///   <item>多显示器：协调器在每个屏幕上各开一个本窗口；</item>
///   <item>禁止关闭：拦截 <see cref="OnClosing"/> 并取消，除非已解除熄灯或应用正在退出；</item>
///   <item>纯黑背景 + 低亮度白字：实时时间、剩余时长、轮播文案、场景标签；</item>
///   <item>连续点击 5 次触发紧急解除入口（PRD 2.2.5）。</item>
/// </list>
/// </summary>
public partial class BlackoutWindow : Window
{
    private readonly DesktopCoordinator? _coordinator;
    private readonly TapCounter _taps;

    private DispatcherTimer? _animTimer;
    private DateTime _animStartedAt;
    private bool _entrance = true;
    private bool _allowClose;
    private double _brightness = 0.62;
    private string _shownCopyId = string.Empty;
    private DispatcherTimer? _noticeTimer;

    // ── 拉绳交互状态（进入熄灯时先让用户亲手拉绳）──
    private bool _needsPull;
    private bool _dragging;
    private double _dragStartY;
    private double _pullOffset;
    private const double PullMaxOffset = 120.0;   // 拉到底的位移阈值（DIP）
    private const int PullTimeoutSeconds = 60;    // 60 秒不拉 → 灯自动熄灭（PRD 增强）
    private DispatcherTimer? _pullTimer;           // 60 秒超时倒计时
    private int _pullSecondsLeft;
    private DispatcherTimer? _snapTimer;           // 未拉到底时的回弹动画

    /// <summary>供 XAML 设计器 / 加载器使用的无参构造。</summary>
    public BlackoutWindow()
        : this(null)
    {
    }

    public BlackoutWindow(DesktopCoordinator? coordinator)
    {
        _coordinator = coordinator;
        _taps = new TapCounter(onTrigger: ShowEmergencyPanel);

        InitializeComponent();

        WhitelistButton.Click += (_, _) => ToggleWhitelistPanel();
        WhitelistCloseButton.Click += (_, _) => WhitelistPanel.IsVisible = false;
        AudioButton.Click += (_, _) => ToggleAudioPanel();
        AudioCloseButton.Click += (_, _) => AudioPanel.IsVisible = false;
        SettingsButton.Click += (_, _) => _coordinator?.ShowSettings();
        EmergencyCancelButton.Click += (_, _) => EmergencyPanel.IsVisible = false;
        EmergencyConfirmButton.Click += (_, _) => ConfirmEmergencyUnlock();
        PasswordBox.KeyDown += (_, e) =>
        {
            if (e.Key == Key.Enter)
            {
                ConfirmEmergencyUnlock();
            }
        };
    }

    // ── 生命周期 ────────────────────────────────────────────

    /// <summary>允许真正关闭（应用退出或已解除熄灯时使用）。</summary>
    public void AllowClose() => _allowClose = true;

    protected override void OnClosing(WindowClosingEventArgs e)
    {
        // PRD 三：禁止强制停止 / 关闭——熄灯期间窗口不可被 Alt+F4 或系统关闭
        if (!_allowClose && (_coordinator?.IsBlackoutActive ?? false))
        {
            e.Cancel = true;
            ShowNotice("熄灯期间无法关闭窗口。若确需退出，请使用紧急解除。");
            return;
        }

        _animTimer?.Stop();
        base.OnClosing(e);
    }

    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);

        // 拉绳期间不累计连点（避免误触紧急解除入口）；黑屏阶段连点 5 次才触发
        if (_needsPull)
        {
            _dragging = true;
            _dragStartY = e.GetPosition(this).Y;
            e.Pointer.Capture(this);
            return;
        }

        // PRD 2.2.5：连续点击屏幕 5 次触发紧急解除入口
        _taps.Tap();
    }

    protected override void OnPointerMoved(PointerEventArgs e)
    {
        base.OnPointerMoved(e);

        if (!_dragging || !_needsPull)
        {
            return;
        }

        var delta = e.GetPosition(this).Y - _dragStartY;
        _pullOffset = Math.Clamp(delta, 0, PullMaxOffset);
        UpdatePullPosition();

        // 拉到阈值即触发灭灯（有物理的"咔哒"感，无需等松手）
        if (_pullOffset >= PullMaxOffset)
        {
            TriggerPull();
        }
    }

    protected override void OnPointerReleased(PointerReleasedEventArgs e)
    {
        base.OnPointerReleased(e);

        if (!_dragging)
        {
            return;
        }

        _dragging = false;
        e.Pointer.Capture(null);

        // 没拉到底 → 松手回弹复位
        if (_needsPull && _pullOffset > 0)
        {
            SnapBack();
        }
    }

    // ── 拉绳交互（进入熄灯仪式）─────────────────────────────

    /// <summary>协调器标记"本次进入熄灯需要拉绳"（每个时段仅一次）。</summary>
    public void RequirePull()
    {
        _needsPull = true;
        if (_pullTimer is null)
        {
            StartPullCountdown();
        }
    }

    private void ShowPullLayer()
    {
        _pullOffset = 0;
        UpdatePullPosition();

        PullLayer.IsVisible = true;
        MainContent.Opacity = 0;
        LampLayer.Opacity = 0;
        DimLayer.Opacity = 1;
        WarmGlow.Opacity = 0;

        StartPullCountdown();
    }

    private void UpdatePullPosition()
    {
        PullCordGroup.RenderTransform = new TranslateTransform(0, _pullOffset);
    }

    private void StartPullCountdown()
    {
        StopPullCountdown();
        _pullSecondsLeft = PullTimeoutSeconds;

        _pullTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _pullTimer.Tick += (_, _) =>
        {
            _pullSecondsLeft -= 1;
            if (_pullSecondsLeft <= 0)
            {
                PullCountdown.Text = "灯已自动熄灭";
                TriggerPull();
                return;
            }
            PullCountdown.Text = $"灯将在 {_pullSecondsLeft} 秒后自动熄灭";
        };
        _pullTimer.Start();

        PullCountdown.Text = $"灯将在 {_pullSecondsLeft} 秒后自动熄灭";
    }

    private void StopPullCountdown()
    {
        _pullTimer?.Stop();
        _pullTimer = null;
    }

    /// <summary>未拉到底时的回弹动画：绳子弹回原位。</summary>
    private void SnapBack()
    {
        _snapTimer?.Stop();
        _snapTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(16) };
        _snapTimer.Tick += (_, _) =>
        {
            _pullOffset -= Math.Max(3, _pullOffset * 0.22);
            if (_pullOffset <= 0.5)
            {
                _pullOffset = 0;
                _snapTimer?.Stop();
                _snapTimer = null;
            }
            UpdatePullPosition();
        };
        _snapTimer.Start();
    }

    /// <summary>拉绳成功（或超时自动熄灭）：进入熄灯渐变动画。</summary>
    private void TriggerPull()
    {
        if (!_needsPull)
        {
            return;
        }

        _needsPull = false;
        _dragging = false;
        _snapTimer?.Stop();
        _snapTimer = null;
        StopPullCountdown();

        PullLayer.IsVisible = false;
        LampLayer.Opacity = 1;
        StartAnimation(entrance: true);
    }

    // ── 屏幕与置顶 ──────────────────────────────────────────

    /// <summary>把窗口铺满指定屏幕（含任务栏区域）。</summary>
    public void PlaceOn(Screen screen)
    {
        var bounds = screen.Bounds;
        var scaling = screen.Scaling <= 0 ? 1d : screen.Scaling;

        Position = new PixelPoint(bounds.X, bounds.Y);
        Width = bounds.Width / scaling;
        Height = bounds.Height / scaling;
    }

    /// <summary>轻量刷新 Z 序（不抢焦点），用于周期性重申置顶。</summary>
    public void RefreshTopmost()
    {
        Topmost = false;
        Topmost = true;
    }

    /// <summary>把窗口强硬拉回最前并抢回焦点（检测到非白名单应用抢焦点时调用）。</summary>
    public void ReassertTopmost()
    {
        RefreshTopmost();
        try
        {
            Activate();
        }
        catch (Exception)
        {
            // 窗口尚未可见时 Activate 可能失败，忽略即可
        }
    }

    /// <summary>进入熄灯：显示窗口并播放入场动画（或先让用户拉绳）。</summary>
    public void PresentForBlackout()
    {
        if (!IsVisible)
        {
            Show();
        }

        // 首次进入该时段：先显示可交互的拉绳，用户亲手拉（或 60 秒超时）后才灭灯
        if (_needsPull)
        {
            ShowPullLayer();
            return;
        }

        // 协调器每 250ms 调用一次本方法，必须避免把动画反复重启导致永远播不完
        if (_animTimer is not null && _entrance)
        {
            return;
        }

        if (_animTimer is null && MainContent.Opacity > 0)
        {
            // 已经在熄灯展示态（入场动画已结束），不重复播放
            return;
        }

        StartAnimation(entrance: true);
    }

    /// <summary>退出熄灯：停止助眠音频，播放退场动画后隐藏窗口。</summary>
    public void BeginExitAndHide()
    {
        if (!IsVisible)
        {
            return;
        }

        AudioService.Stop();

        // 退场动画已在播放时不要重启
        if (_animTimer is not null && !_entrance)
        {
            return;
        }

        StartAnimation(entrance: false);
    }

    // ── 内容刷新 ────────────────────────────────────────────

    public void ApplySnapshot(EngineSnapshot snapshot)
    {
        _brightness = Math.Clamp(snapshot.Settings.Blackout.Brightness, 0.15, 1);

        ClockText.Text = TimeUtil.FormatClock(snapshot.At, seconds: true);
        RemainingText.Text = $"现在睡，还能睡 {TimeUtil.FormatDurationCn(snapshot.RemainingMs)}";
        SceneTag.Text = $"{snapshot.Scene.SceneLabel} · {snapshot.Scene.WeekdayName} · {snapshot.Scene.TimeBucketLabel}";
        QuotaText.Text = $"本周剩余紧急解除 {snapshot.Quota.Remaining} / {snapshot.Quota.Total} 次";

        if (!string.Equals(_shownCopyId, snapshot.Copy.Id, StringComparison.Ordinal))
        {
            _shownCopyId = snapshot.Copy.Id;
            CopyText.Text = snapshot.Copy.Text;
        }

        if (WhitelistPanel.IsVisible)
        {
            RefreshWhitelistPanel();
        }

        // 动画已结束的情况下，让文字亮度跟随设置
        if (_animTimer is null)
        {
            MainContent.Opacity = _brightness;
        }
    }

    // ── 入场 / 退场动画（PRD 4.3，约 1.5 秒）────────────────

    private void StartAnimation(bool entrance)
    {
        _entrance = entrance;
        _animStartedAt = DateTime.UtcNow;

        WhitelistPanel.IsVisible = false;
        EmergencyPanel.IsVisible = false;
        LampLayer.Opacity = 1;

        _animTimer?.Stop();
        _animTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(16) };
        _animTimer.Tick += (_, _) => StepAnimation();
        _animTimer.Start();
        StepAnimation();
    }

    private void StepAnimation()
    {
        var elapsed = (DateTime.UtcNow - _animStartedAt).TotalMilliseconds;
        var progress = Math.Clamp(elapsed / Limits.AnimationMs, 0, 1);

        // e = "灯还亮着"的程度：入场 1 → 0，退场 0 → 1
        var e = _entrance ? 1 - progress : progress;

        Bulb.Opacity = 0.05 + (0.95 * e);
        LampLayer.Opacity = e;
        DimLayer.Opacity = e;
        // 暖光强度随"灯还亮着"的程度同步变化：灯灭则光线退场，灯亮则温暖光晕浮现
        WarmGlow.Opacity = e * 0.9;
        MainContent.Opacity = (1 - e) * _brightness;

        if (progress < 1)
        {
            return;
        }

        _animTimer?.Stop();
        _animTimer = null;

        if (_entrance)
        {
            LampLayer.Opacity = 0;
            DimLayer.Opacity = 0;
            WarmGlow.Opacity = 0;
            MainContent.Opacity = _brightness;
        }
        else
        {
            Hide();
        }
    }

    // ── 白名单 ──────────────────────────────────────────────

    /// <summary>同步白名单共用时长剩余（协调器心跳调用）。</summary>
    public void UpdateWhitelistRemaining(long remainingMs, long totalMs)
    {
        _whitelistRemainingMs = remainingMs;
        _whitelistTotalMs = totalMs;
        if (WhitelistPanel.IsVisible)
        {
            RefreshWhitelistPanel();
        }
    }

    private long _whitelistRemainingMs;
    private long _whitelistTotalMs;

    private void ToggleWhitelistPanel()
    {
        WhitelistPanel.IsVisible = !WhitelistPanel.IsVisible;
        if (WhitelistPanel.IsVisible)
        {
            RefreshWhitelistPanel();
        }
    }

    private void RefreshWhitelistPanel()
    {
        var settings = _coordinator?.Settings.Value;
        if (settings is null)
        {
            return;
        }

        WhitelistSummary.Text =
            $"所有白名单应用共用总时长 {settings.Whitelist.TotalMinutes} 分钟（上限 60 分钟）；" +
            $"用户应用最多 {Limits.WhitelistAppCountMax} 个，" +
            "系统电话 / 短信不受限且不占用时长。白名单应用在前台时熄灯界面会暂时让出，切回其他应用立即恢复。";

        if (_whitelistTotalMs > 0)
        {
            var remainingMinutes = Math.Ceiling(_whitelistRemainingMs / 60_000d);
            var totalMinutes = Math.Ceiling(_whitelistTotalMs / 60_000d);
            WhitelistSummary.Text += $" 本次熄灯剩余 {remainingMinutes:0} / {totalMinutes:0} 分钟。";
        }

        WhitelistList.Children.Clear();
        foreach (var app in settings.Whitelist.Apps)
        {
            var process = string.IsNullOrWhiteSpace(app.ProcessName) ? "未绑定进程" : app.ProcessName;
            var suffix = app.CountsAgainstQuota ? string.Empty : " · 不占用时长";
            var locked = app.Removable ? string.Empty : " · 不可移除";

            WhitelistList.Children.Add(new TextBlock
            {
                Text = $"{app.Name}（进程：{process}）{suffix}{locked}",
                FontSize = 13,
                Foreground = new SolidColorBrush(Color.Parse("#B0B0B0")),
                TextWrapping = TextWrapping.Wrap,
                MaxWidth = 520,
            });
        }
    }

    // ── 助眠音频（PRD 2.3）──────────────────────────────────

    private void ToggleAudioPanel()
    {
        AudioPanel.IsVisible = !AudioPanel.IsVisible;
        if (AudioPanel.IsVisible)
        {
            RefreshAudioPanel();
        }
    }

    private void RefreshAudioPanel()
    {
        AudioPresetButtons.Children.Clear();

        foreach (var (id, name, _) in AudioService.Presets)
        {
            var presetId = id;
            var isCurrent = string.Equals(AudioService.CurrentPresetId, presetId, StringComparison.Ordinal);
            var button = new Button
            {
                Content = (isCurrent ? "▶ " : "") + name,
                Padding = new Thickness(18, 9),
                Background = isCurrent ? new SolidColorBrush(Color.Parse("#2E2E2E")) : null,
            };
            button.Click += (_, _) => PlayPreset(presetId);
            AudioPresetButtons.Children.Add(button);
        }

        var stopButton = new Button { Content = "停止", Padding = new Thickness(18, 9) };
        stopButton.Click += (_, _) =>
        {
            AudioService.Stop();
            AudioHint.Text = "已停止播放。";
            RefreshAudioPanel();
        };
        AudioPresetButtons.Children.Add(stopButton);

        AudioHint.Text = AudioService.CurrentPresetId is null
            ? "选择一种声音循环播放助眠；熄灯期间可随时停止。退出熄灯时自动停止。"
            : "正在循环播放，选择其他声音可直接切换。";
    }

    private void PlayPreset(string presetId)
    {
        var preset = AudioService.Presets.FirstOrDefault(item => item.Id == presetId);
        var ok = AudioService.Play(presetId);
        AudioHint.Text = ok
            ? $"正在播放：{preset.Name}（循环）。"
            : "播放失败：音频资源不可用。";
        RefreshAudioPanel();
    }

    // ── 紧急解除 ────────────────────────────────────────────

    private void ShowEmergencyPanel()
    {
        var settings = _coordinator?.Settings.Value;
        var quota = _coordinator?.Current.Quota;

        if (settings is null || quota is null)
        {
            return;
        }

        if (quota.Remaining <= 0)
        {
            ShowNotice("本周紧急解除额度已用完，只能等待熄灯时段结束。");
            return;
        }

        if (string.IsNullOrEmpty(settings.Emergency.PasswordHash))
        {
            ShowNotice("尚未设置紧急解除密码，请先在设置窗口中设置。");
            return;
        }

        EmergencyHint.Text = $"输入密码可退出本次熄灯。本周剩余 {quota.Remaining} 次，每解除一次消耗 1 次。";
        EmergencyMessage.Text = string.Empty;
        PasswordBox.Text = string.Empty;
        EmergencyPanel.IsVisible = true;
        PasswordBox.Focus();
    }

    private void ConfirmEmergencyUnlock()
    {
        if (_coordinator is null)
        {
            return;
        }

        var result = _coordinator.TryEmergencyUnlock(PasswordBox.Text ?? string.Empty);
        if (result.Ok)
        {
            EmergencyPanel.IsVisible = false;
            ShowNotice($"已解除本次熄灯，本周剩余 {result.Remaining} 次。次日将按计划自动恢复。");
            return;
        }

        EmergencyMessage.Text = result.Reason switch
        {
            "bad-password" => "密码不正确。",
            "quota-exhausted" => "本周解除额度已用完。",
            "not-active" => "当前不在熄灯时段内。",
            "no-password" => "尚未设置紧急解除密码。",
            _ => "解除失败。",
        };
    }

    // ── 提示条 ──────────────────────────────────────────────

    private void ShowNotice(string message)
    {
        NoticeText.Text = message;
        NoticeBar.IsVisible = true;

        _noticeTimer?.Stop();
        _noticeTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(6) };
        _noticeTimer.Tick += (_, _) =>
        {
            NoticeBar.IsVisible = false;
            _noticeTimer?.Stop();
            _noticeTimer = null;
        };
        _noticeTimer.Start();
    }
}
