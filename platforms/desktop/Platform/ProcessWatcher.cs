using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace Xideng.Desktop.Platform;

/// <summary>前台窗口所属应用的信息。</summary>
public sealed record ForegroundAppInfo(int ProcessId, string ProcessName, string WindowTitle);

/// <summary>
/// 前台进程监听抽象（PRD 5.2「程序运行监听权限」/ PRD 5.3「应用运行监听权限」）。
///
/// 熄灯时段内，若检测到<b>非白名单应用</b>获得前台焦点，立即把熄灯窗口重新置顶
/// （PRD 三、防绕过："禁止清理后台 / 锁定应用后台进程"的桌面等效实现）。
///
/// 平台差异是刻意抽象的：
/// <list type="bullet">
///   <item>Windows：已实现（GetForegroundWindow + GetWindowThreadProcessId）；</item>
///   <item>macOS：<b>待实现</b>——需要 NSWorkspace 的 <c>frontmostApplication</c>（本机无 macOS 环境验证，见 README）；</item>
///   <item>Linux：<b>待实现</b>——需要 X11 EWMH 或 AT-SPI，依赖桌面环境，未做验证。</item>
/// </list>
/// </summary>
public interface IProcessWatcher : IDisposable
{
    /// <summary>本平台是否具备真实的前台进程监听能力。</summary>
    bool IsSupported { get; }

    /// <summary>能力说明，UI 与自检会如实展示，不做夸大。</summary>
    string SupportNote { get; }

    /// <summary>前台应用发生变化时触发。</summary>
    event Action<ForegroundAppInfo>? ForegroundChanged;

    /// <summary>读取当前前台应用信息；平台不支持或当前无前台窗口时返回 null。</summary>
    ForegroundAppInfo? QueryForeground();

    void Start(int intervalMs);

    void Stop();
}

/// <summary>
/// Windows 实现：轮询前台窗口并解析其所属进程。
/// </summary>
public sealed class WindowsProcessWatcher : IProcessWatcher
{
    private readonly object _gate = new();
    private Timer? _timer;
    private int _lastProcessId = -1;
    private string _lastProcessName = string.Empty;
    private bool _disposed;

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetWindowTextLengthW(IntPtr hWnd);

    public bool IsSupported => OperatingSystem.IsWindows();

    public string SupportNote => "Windows：已实现（GetForegroundWindow + GetWindowThreadProcessId 轮询）";

    public event Action<ForegroundAppInfo>? ForegroundChanged;

    public void Start(int intervalMs)
    {
        lock (_gate)
        {
            if (_disposed || !IsSupported)
            {
                return;
            }

            Stop();
            _timer = new Timer(_ => Poll(), null, 0, Math.Clamp(intervalMs, 200, 10_000));
        }
    }

    public void Stop()
    {
        lock (_gate)
        {
            _timer?.Dispose();
            _timer = null;
        }
    }

    private void Poll()
    {
        try
        {
            var info = QueryForeground();
            if (info is null)
            {
                return;
            }

            // 只在"前台应用发生切换"时上报，避免每 700ms 都触发一次置顶风暴
            if (info.ProcessId == _lastProcessId &&
                string.Equals(info.ProcessName, _lastProcessName, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            _lastProcessId = info.ProcessId;
            _lastProcessName = info.ProcessName;
            ForegroundChanged?.Invoke(info);
        }
        catch (Exception)
        {
            // 轮询失败不能影响熄灯主流程
        }
    }

    /// <summary>读取当前前台应用信息；无前台窗口时返回 null。</summary>
    public ForegroundAppInfo? QueryForeground() => QueryForegroundImpl();

    /// <summary>读取当前前台窗口信息；无前台窗口时返回 null。</summary>
    public static ForegroundAppInfo? QueryForegroundImpl()
    {
        var hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero)
        {
            return null;
        }

        _ = GetWindowThreadProcessId(hwnd, out var pid);
        if (pid == 0)
        {
            return null;
        }

        var title = ReadWindowTitle(hwnd);
        var name = ResolveProcessName((int)pid);
        return new ForegroundAppInfo((int)pid, name, title);
    }

    private static string ReadWindowTitle(IntPtr hwnd)
    {
        var length = GetWindowTextLengthW(hwnd);
        if (length <= 0)
        {
            return string.Empty;
        }

        var buffer = new StringBuilder(length + 1);
        _ = GetWindowTextW(hwnd, buffer, buffer.Capacity);
        return buffer.ToString();
    }

    private static string ResolveProcessName(int pid)
    {
        try
        {
            using var process = Process.GetProcessById(pid);
            return process.ProcessName;
        }
        catch (Exception)
        {
            // 进程可能已退出，或权限不足（例如以管理员身份运行的前台程序）
            return string.Empty;
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            _disposed = true;
            _timer?.Dispose();
            _timer = null;
        }
    }
}

/// <summary>
/// macOS / Linux 的降级实现：<b>不具备真实监听能力</b>，但保证接口调用安全，
/// 并通过 <see cref="SupportNote"/> 如实说明"待实现"，不含任何夸大。
/// </summary>
public sealed class UnsupportedProcessWatcher : IProcessWatcher
{
    public bool IsSupported => false;

    public string SupportNote { get; }

    public UnsupportedProcessWatcher()
    {
        SupportNote = OperatingSystem.IsMacOS()
            ? "macOS：待实现（需 NSWorkspace.frontmostApplication，本机无 macOS 环境可验证）"
            : "当前平台：待实现（Linux 需 X11 EWMH 或 AT-SPI，依赖具体桌面环境，未做验证）";
    }

    public event Action<ForegroundAppInfo>? ForegroundChanged
    {
        // 明确屏蔽订阅：降级实现永远不会产生事件，避免调用方误以为监听到位
        add => _ = value;
        remove => _ = value;
    }

    public ForegroundAppInfo? QueryForeground() => null;

    public void Start(int intervalMs)
    {
    }

    public void Stop()
    {
    }

    public void Dispose()
    {
    }
}

/// <summary>按当前操作系统创建合适的前台进程监听器。</summary>
public static class ProcessWatcherFactory
{
    public static IProcessWatcher Create() =>
        OperatingSystem.IsWindows() ? new WindowsProcessWatcher() : new UnsupportedProcessWatcher();
}
