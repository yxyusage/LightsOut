using System.Diagnostics;
using System.Text.Json;
using Avalonia.Controls;
using Avalonia.Threading;
using Xideng.Desktop.Core;
using Xideng.Desktop.Platform;
using Xideng.Desktop.Views;

namespace Xideng.Desktop;

/// <summary>
/// 桌面端协调器：把核心引擎接到真实的窗口、定时器与前台进程监听上。
///
/// 职责边界：
/// <list type="bullet">
///   <item>持有 <see cref="SettingsStore"/> / <see cref="QuotaStore"/> / <see cref="Engine"/>（持久化到用户目录）；</item>
///   <item>用 <see cref="DispatcherTimer"/> 驱动 250ms 心跳（对应 Web 端的 tick scheduler）；</item>
///   <item>按相位显示 / 隐藏全屏置顶熄灯窗口（<b>每个屏幕一个</b>）；</item>
///   <item>前台进程监听：非白名单应用抢焦点时立刻重新置顶（PRD 三）；</item>
///   <item>系统时间篡改检测与违规记录（PRD 三）。</item>
/// </list>
/// </summary>
public sealed class DesktopCoordinator : IDisposable
{
    /// <summary>被前台抢占时允许放行的系统外壳进程（不是"用户应用"）。</summary>
    private static readonly HashSet<string> ShellProcesses = new(StringComparer.OrdinalIgnoreCase)
    {
        "explorer", "ShellExperienceHost", "StartMenuExperienceHost", "SearchHost",
        "TextInputHost", "LockApp", "LogonUI", "dwm", "ApplicationFrameHost",
    };

    private readonly IKeyValueStore _storage;
    private readonly List<BlackoutWindow> _blackoutWindows = [];
    private readonly ViolationLog _violations;
    private readonly IProcessWatcher _processWatcher;
    private readonly ClockGuard _clockGuard;

    private DispatcherTimer? _timer;
    private SettingsWindow? _settingsWindow;
    private bool _disposed;
    private bool _watcherRunning;
    private bool _wasActive;
    private DateTime _nextCopyRotateAt = DateTime.MinValue;
    private DateTime _nextTopmostRefreshAt = DateTime.MinValue;
    private DateTime _previewUntil = DateTime.MinValue;

    public DesktopCoordinator()
    {
        AppPaths.EnsureUserDataDir();
        _storage = new JsonFileKeyValueStore(AppPaths.SettingsFile);
        Settings = new SettingsStore(_storage);
        Quota = new QuotaStore(_storage, "quota", Settings.Value.Emergency.QuotaTotal);
        Engine = new Engine(Settings, Quota);
        _violations = new ViolationLog(new JsonFileKeyValueStore(AppPaths.ViolationsFile));

        _processWatcher = ProcessWatcherFactory.Create();
        _processWatcher.ForegroundChanged += OnForegroundChanged;

        _clockGuard = new ClockGuard();
        Current = Engine.Snapshot(DateTime.Now);
    }

    public SettingsStore Settings { get; }

    public QuotaStore Quota { get; }

    public Engine Engine { get; }

    public EngineSnapshot Current { get; private set; }

    public IProcessWatcher ProcessWatcher => _processWatcher;

    /// <summary>违规记录（PRD 三：记录违规行为）。</summary>
    public IReadOnlyList<string> RecentViolations => _violations.Recent();

    public event Action<EngineSnapshot>? Updated;

    public event Action<string>? Notice;

    /// <summary>是否处于强制熄灯中。</summary>
    public bool IsBlackoutActive => Current.Phase == Core.Phase.Active;

    /// <summary>启动心跳。</summary>
    public void Start()
    {
        if (_timer is not null)
        {
            return;
        }

        _timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
        _timer.Tick += (_, _) => Tick();
        _timer.Start();
        Tick();
    }

    /// <summary>一次心跳：时间篡改检测 → 相位计算 → 窗口显隐与内容刷新。</summary>
    public void Tick()
    {
        if (_disposed)
        {
            return;
        }

        var now = DateTime.Now;

        if (Settings.Value.Guard.DetectClockTamper)
        {
            var jump = _clockGuard.Sample();
            if (jump is not null)
            {
                HandleClockTamper(jump, now);
            }
        }

        var probe = Engine.Snapshot(now);
        var active = probe.Phase == Core.Phase.Active;

        // 文案轮播（PRD 2.2.2）：每次进入熄灯都从第一句开始，之后按设置的间隔推进
        if (active && !_wasActive)
        {
            Engine.ResetCopy(now);
            _nextCopyRotateAt = now.AddMilliseconds(Math.Max(1000, probe.CopyIntervalMs));
        }
        else if (active && now >= _nextCopyRotateAt)
        {
            Engine.RotateCopy(now);
            _nextCopyRotateAt = now.AddMilliseconds(Math.Max(1000, probe.CopyIntervalMs));
        }

        _wasActive = active;

        var snapshot = Engine.Snapshot(now);
        Current = snapshot;

        if (active || now < _previewUntil)
        {
            ShowBlackout(snapshot);
        }
        else
        {
            HideBlackout();
        }

        UpdateWatcherState(snapshot);
        Updated?.Invoke(snapshot);
    }

    /// <summary>临时预览熄灯窗口（设置界面的"测试熄灯窗口"按钮）。</summary>
    public void StartBlackoutPreview(TimeSpan duration)
    {
        _previewUntil = DateTime.Now.Add(duration);
        Tick();
    }

    /// <summary>结束预览。</summary>
    public void StopBlackoutPreview()
    {
        _previewUntil = DateTime.MinValue;
        Tick();
    }

    // ── 熄灯窗口 ────────────────────────────────────────────

    private void ShowBlackout(EngineSnapshot snapshot)
    {
        EnsureBlackoutWindows();

        foreach (var window in _blackoutWindows)
        {
            window.PresentForBlackout();
            window.ApplySnapshot(snapshot);
        }

        // 周期性轻量重申置顶（不抢焦点）；真正的强制抢占由前台进程监听触发。
        // 若每 250ms 都 Activate()，用户将完全无法使用白名单应用。
        if (Settings.Value.Guard.ReassertTopmost && DateTime.UtcNow >= _nextTopmostRefreshAt)
        {
            _nextTopmostRefreshAt = DateTime.UtcNow.AddSeconds(3);
            foreach (var window in _blackoutWindows)
            {
                window.RefreshTopmost();
            }
        }
    }

    private void HideBlackout()
    {
        foreach (var window in _blackoutWindows)
        {
            if (window.IsVisible)
            {
                window.BeginExitAndHide();
            }
        }
    }

    private void EnsureBlackoutWindows()
    {
        if (_blackoutWindows.Count > 0)
        {
            return;
        }

        var first = new BlackoutWindow(this);
        _blackoutWindows.Add(first);

        // 多显示器：在所有屏幕上各开一个窗口（PRD 2.2.1 的桌面等效实现）
        var screens = first.Screens.All;
        for (var i = 1; i < screens.Count; i++)
        {
            _blackoutWindows.Add(new BlackoutWindow(this));
        }

        ApplyScreenBounds();
    }

    /// <summary>把每个窗口铺满对应的屏幕（含任务栏区域，真正的全屏接管）。</summary>
    public void ApplyScreenBounds()
    {
        if (_blackoutWindows.Count == 0)
        {
            return;
        }

        var screens = _blackoutWindows[0].Screens.All;
        for (var i = 0; i < _blackoutWindows.Count; i++)
        {
            var window = _blackoutWindows[i];
            if (i >= screens.Count)
            {
                // 显示器被拔掉：把多余窗口放到最后一个屏幕上，避免凭空消失
                if (screens.Count == 0)
                {
                    continue;
                }

                window.PlaceOn(screens[^1]);
                continue;
            }

            window.PlaceOn(screens[i]);
        }
    }

    /// <summary>把所有熄灯窗口强制拉回最前（PRD 三、防绕过）。</summary>
    public void ReassertTopmost()
    {
        foreach (var window in _blackoutWindows)
        {
            if (!window.IsVisible)
            {
                continue;
            }

            window.ReassertTopmost();
        }
    }

    // ── 前台进程监听 ────────────────────────────────────────

    private void UpdateWatcherState(EngineSnapshot snapshot)
    {
        var wanted = snapshot.Phase == Core.Phase.Active
                     && Settings.Value.Desktop.ProcessWatch
                     && _processWatcher.IsSupported;

        if (wanted && !_watcherRunning)
        {
            _processWatcher.Start(Settings.Value.Desktop.ProcessWatchIntervalMs);
            _watcherRunning = true;
        }
        else if (!wanted && _watcherRunning)
        {
            _processWatcher.Stop();
            _watcherRunning = false;
        }
    }

    private void OnForegroundChanged(ForegroundAppInfo info)
    {
        if (!IsBlackoutActive)
        {
            return;
        }

        if (info.ProcessId == Environment.ProcessId)
        {
            return;
        }

        if (ShellProcesses.Contains(info.ProcessName) || IsWhitelistedProcess(info.ProcessName))
        {
            return;
        }

        if (Settings.Value.Desktop.RecordFocusViolation)
        {
            _violations.Record("foreground", $"{info.ProcessName} (pid {info.ProcessId})", DateTimeOffset.Now);
        }

        ReassertTopmost();
    }

    /// <summary>该进程是否在白名单中（PRD 2.2.3）。</summary>
    public bool IsWhitelistedProcess(string processName)
    {
        if (string.IsNullOrWhiteSpace(processName))
        {
            return false;
        }

        return Settings.Value.Whitelist.Apps.Any(app =>
            !string.IsNullOrWhiteSpace(app.ProcessName) &&
            string.Equals(app.ProcessName, processName, StringComparison.OrdinalIgnoreCase));
    }

    private void HandleClockTamper(ClockJumpEvent jump, DateTime now)
    {
        _violations.Record("clock-tamper", $"{jump.Direction} {jump.DriftMs}ms", jump.At);

        // PRD 三：立即恢复熄灯模式，并且不重置剩余时长（剩余时长始终由真实时钟重算，而非做自减计数）
        Engine.Rearm();
        _clockGuard.Reset();

        var snapshot = Engine.Snapshot(now);
        if (snapshot.Phase == Core.Phase.Active)
        {
            ShowBlackout(snapshot);
        }

        Notice?.Invoke($"检测到系统时间被修改（{jump.Direction} {jump.DriftMs / 1000.0:0} 秒），已恢复熄灯模式并记录违规。");
    }

    // ── 紧急解除 ────────────────────────────────────────────

    public UnlockResult TryEmergencyUnlock(string password) => Engine.EmergencyUnlock(password, DateTime.Now);

    // ── 设置窗口 ────────────────────────────────────────────

    public SettingsWindow? SettingsWindow => _settingsWindow;

    /// <summary>取得（必要时创建）设置窗口实例。</summary>
    public SettingsWindow EnsureSettingsWindow()
    {
        if (_settingsWindow is null)
        {
            _settingsWindow = new SettingsWindow(this);
            _settingsWindow.Closed += (_, _) => _settingsWindow = null;
        }

        return _settingsWindow;
    }

    public void ShowSettings()
    {
        var window = EnsureSettingsWindow();
        if (!window.IsVisible)
        {
            window.Show();
        }

        window.Activate();
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _timer?.Stop();
        _timer = null;
        _processWatcher.ForegroundChanged -= OnForegroundChanged;
        _processWatcher.Dispose();

        foreach (var window in _blackoutWindows)
        {
            window.AllowClose();
            window.Close();
        }

        _blackoutWindows.Clear();

        if (_settingsWindow?.IsVisible == true)
        {
            _settingsWindow.Close();
        }

        _settingsWindow = null;
    }
}

/// <summary>
/// 违规行为记录（PRD 三：记录违规行为）。持久化为 JSON 数组，只保留最近 200 条。
/// </summary>
public sealed class ViolationLog
{
    private const string Key = "violations";
    private const int MaxEntries = 200;

    private readonly IKeyValueStore _store;

    public ViolationLog(IKeyValueStore store) => _store = store;

    public void Record(string kind, string detail, DateTimeOffset at)
    {
        var entries = Load();
        entries.Add($"{at:yyyy-MM-dd HH:mm:ss}	{kind}	{detail}");
        if (entries.Count > MaxEntries)
        {
            entries.RemoveRange(0, entries.Count - MaxEntries);
        }

        try
        {
            _store.SetItem(Key, JsonSerializer.Serialize(entries));
        }
        catch (Exception)
        {
            // 记录失败不能影响熄灯主流程
        }
    }

    public IReadOnlyList<string> Recent()
    {
        var entries = Load();
        entries.Reverse();
        return entries;
    }

    private List<string> Load()
    {
        try
        {
            var raw = _store.GetItem(Key);
            if (string.IsNullOrEmpty(raw))
            {
                return [];
            }

            return JsonSerializer.Deserialize<List<string>>(raw) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }
}
