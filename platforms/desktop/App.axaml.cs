using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;

namespace Xideng.Desktop;

public partial class App : Application
{
    private DesktopCoordinator? _coordinator;

    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            _coordinator = new DesktopCoordinator();

            // 熄灯期间关闭设置窗口不应退出应用（熄灯窗口仍在强制接管）
            desktop.ShutdownMode = ShutdownMode.OnExplicitShutdown;

            var settingsWindow = _coordinator.EnsureSettingsWindow();
            desktop.MainWindow = settingsWindow;

            settingsWindow.Closed += (_, _) =>
            {
                if (_coordinator is null || _coordinator.IsBlackoutActive)
                {
                    return;
                }

                _coordinator.Dispose();
                desktop.Shutdown();
            };

            desktop.Exit += (_, _) => _coordinator?.Dispose();

            // 启动心跳：由相位驱动熄灯窗口的显隐与前台进程监听
            _coordinator.Start();
        }

        base.OnFrameworkInitializationCompleted();
    }
}
