using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Avalonia.Platform;

namespace Xideng.Desktop;

public partial class App : Application
{
    private DesktopCoordinator? _coordinator;
    private TrayIcon? _trayIcon;
    private bool _exiting;

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

            // 关闭设置窗口 → 隐藏到系统托盘，应用继续后台运行（计划、熄灯、进程监听照常生效）
            settingsWindow.Closed += (_, _) =>
            {
                if (!_exiting)
                {
                    _coordinator?.SettingsWindow?.Hide();
                }
            };

            desktop.Exit += (_, _) =>
            {
                _exiting = true;
                _trayIcon?.Dispose();
                _trayIcon = null;
                _coordinator?.Dispose();
            };

            SetupTrayIcon(desktop);

            // 启动心跳：由相位驱动熄灯窗口的显隐与前台进程监听
            _coordinator.Start();
            settingsWindow.Show();
        }

        base.OnFrameworkInitializationCompleted();
    }

    /// <summary>系统托盘：图标 + 右键菜单 + 左键唤起设置。</summary>
    private void SetupTrayIcon(IClassicDesktopStyleApplicationLifetime desktop)
    {
        if (_coordinator is null)
        {
            return;
        }

        var menu = new NativeMenu();

        var openItem = new NativeMenuItem("打开设置");
        openItem.Click += (_, _) => ShowSettingsWindow();

        var previewItem = new NativeMenuItem("立即预览熄灯（12 秒）");
        previewItem.Click += (_, _) => _coordinator.StartBlackoutPreview(TimeSpan.FromSeconds(12));

        var exitItem = new NativeMenuItem("退出");
        exitItem.Click += (_, _) => ExitApp(desktop);

        menu.Items.Add(openItem);
        menu.Items.Add(previewItem);
        menu.Items.Add(new NativeMenuItemSeparator());
        menu.Items.Add(exitItem);

        try
        {
            _trayIcon = new TrayIcon
            {
                Icon = new WindowIcon(AssetLoader.Open(new Uri("avares://Xideng.Desktop/assets/tray.png"))),
                ToolTipText = "熄灯早睡 · 到点熄灯，把设备交还给睡眠",
                Menu = menu,
                IsVisible = true,
            };
            _trayIcon.Clicked += (_, _) => ShowSettingsWindow();
        }
        catch (Exception)
        {
            // 托盘创建失败（例如无托盘环境）不阻断主流程；应用仍可通过设置窗口关闭逻辑运行
            _trayIcon = null;
        }
    }

    private void ShowSettingsWindow()
    {
        var window = _coordinator?.EnsureSettingsWindow();
        if (window is null)
        {
            return;
        }

        window.WindowState = WindowState.Normal;
        window.Show();
        window.Activate();
    }

    private void ExitApp(IClassicDesktopStyleApplicationLifetime desktop)
    {
        _exiting = true;
        // 允许熄灯窗口 / 设置窗口关闭，随后退出整个应用
        desktop.Shutdown();
    }
}
