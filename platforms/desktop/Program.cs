using Avalonia;

namespace Xideng.Desktop;

/// <summary>
/// 桌面端入口。
///
/// <c>--selftest</c> 走完全独立的控制台路径，<b>不初始化 Avalonia、不创建任何窗口</b>，
/// 因此可以在无图形会话（CI / 远程控制台）中作为主要验收手段运行。
/// </summary>
internal static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        if (args.Any(arg => string.Equals(arg, "--selftest", StringComparison.OrdinalIgnoreCase)))
        {
            return SelfTest.Run(args);
        }

        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
        return 0;
    }

    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>()
            .UsePlatformDetect()
            .WithInterFont()
            .LogToTrace();
}
