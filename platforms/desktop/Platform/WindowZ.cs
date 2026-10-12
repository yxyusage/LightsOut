using System.Runtime.InteropServices;

namespace Xideng.Desktop.Platform;

/// <summary>
/// Windows 窗口层级操作（白名单"只放行这一个、其他全黑"的桌面端实现）。
///
/// 原理：熄灯黑屏窗口是<b>置顶层（TOPMOST）</b>，会遮住桌面上所有普通窗口。
/// 白名单应用获得前台焦点时，把<b>该进程的所有顶层窗口临时提升到置顶层</b>——
/// 于是只有白名单应用浮在黑屏之上可见可用，桌面和其他应用仍被黑屏完全遮挡；
/// 离开白名单时把这些窗口降回普通层，黑屏恢复"遮住一切"。
/// 相比"隐藏黑屏"方案，这不会把整个桌面一并暴露出来。
/// </summary>
public static class WindowZ
{
    private const int HWND_TOPMOST = -1;
    private const int HWND_NOTOPMOST = -2;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_SHOWWINDOW = 0x0040;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    /// <summary>把指定进程的所有可见顶层窗口提升到置顶层。返回处理的窗口数。</summary>
    public static int PromoteProcessWindows(int processId)
    {
        return ApplyToProcess(processId, HWND_TOPMOST);
    }

    /// <summary>把指定进程的所有可见顶层窗口降回普通层（被黑屏重新遮住）。返回处理的窗口数。</summary>
    public static int DemoteProcessWindows(int processId)
    {
        return ApplyToProcess(processId, HWND_NOTOPMOST);
    }

    private static int ApplyToProcess(int processId, int insertAfter)
    {
        if (processId <= 0)
        {
            return 0;
        }

        var count = 0;
        EnumWindows((hwnd, lparam) =>
        {
            if (!IsWindowVisible(hwnd))
            {
                return true;
            }

            _ = GetWindowThreadProcessId(hwnd, out var pid);
            if (pid != processId)
            {
                return true;
            }

            _ = SetWindowPos(
                hwnd,
                new IntPtr(insertAfter),
                0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
            count++;
            return true;
        }, IntPtr.Zero);

        return count;
    }
}
