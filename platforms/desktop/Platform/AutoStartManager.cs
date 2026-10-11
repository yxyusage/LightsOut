using System.Runtime.Versioning;
using Microsoft.Win32;
using Xideng.Desktop.Core;

namespace Xideng.Desktop.Platform;

/// <summary>
/// 开机自启动（PRD 5.2「开机自启动权限」/ PRD 5.3「开机自启动权限」）。
///
/// <list type="bullet">
///   <item>Windows：写 <c>HKCU\Software\Microsoft\Windows\CurrentVersion\Run</c>（<b>已实现并在本机验证</b>）；</item>
///   <item>macOS：写 <c>~/Library/LaunchAgents/com.xideng.desktop.plist</c>（<b>已实现，未验证</b>——本机无 macOS）；</item>
///   <item>Linux：写 <c>~/.config/autostart/xideng-desktop.desktop</c>（<b>已实现，未验证</b>）。</item>
/// </list>
/// </summary>
public static class AutoStartManager
{
    /// <summary>注册表 / plist 中使用的标识名。</summary>
    public const string EntryName = "XidengDesktop";

    public const string MacLabel = "com.xideng.desktop";

    /// <summary>本平台是否支持开机自启动。</summary>
    public static bool IsSupported => OperatingSystem.IsWindows() || OperatingSystem.IsMacOS() || OperatingSystem.IsLinux();

    public static string SupportNote
    {
        get
        {
            if (OperatingSystem.IsWindows())
            {
                return "Windows：HKCU Run 注册表项（已在本机验证）";
            }

            if (OperatingSystem.IsMacOS())
            {
                return "macOS：~/Library/LaunchAgents plist（未验证，本机无 macOS 环境）";
            }

            return "Linux：~/.config/autostart .desktop（未验证）";
        }
    }

    /// <summary>用于自启动的完整命令行（已加引号，路径含空格时也安全）。</summary>
    public static string CommandLine
    {
        get
        {
            var exe = Environment.ProcessPath ?? AppContext.BaseDirectory;
            return $"\"{exe}\"";
        }
    }

    private static string RegistryCommandLine
    {
        get
        {
            // 通过 dotnet 运行时启动时（dotnet run），ProcessPath 指向 dotnet.exe，
            // 此时把托管 dll 路径一并写入，保证登录后能正确拉起本应用。
            var host = Environment.ProcessPath;
            if (host is not null &&
                Path.GetFileNameWithoutExtension(host).Equals("dotnet", StringComparison.OrdinalIgnoreCase))
            {
                var dll = Path.Combine(AppContext.BaseDirectory, "Xideng.Desktop.dll");
                return $"\"{host}\" \"{dll}\"";
            }

            return CommandLine;
        }
    }

    public static bool IsEnabled()
    {
        try
        {
            if (OperatingSystem.IsWindows())
            {
                using var key = Registry.CurrentUser.OpenSubKey(
                    @"Software\Microsoft\Windows\CurrentVersion\Run",
                    writable: false);
                return key?.GetValue(EntryName) is string value && !string.IsNullOrWhiteSpace(value);
            }

            if (OperatingSystem.IsMacOS())
            {
                return File.Exists(AppPaths.LaunchAgentFile);
            }

            if (OperatingSystem.IsLinux())
            {
                return File.Exists(AppPaths.LinuxAutostartFile);
            }
        }
        catch (Exception)
        {
            // 读不到就当作未启用，不抛异常给 UI
        }

        return false;
    }

    /// <summary>开关自启动。<paramref name="message"/> 返回人类可读的结果说明。</summary>
    public static bool SetEnabled(bool enabled, out string message)
    {
        try
        {
            if (OperatingSystem.IsWindows())
            {
                return SetWindowsRegistry(enabled, out message);
            }

            if (OperatingSystem.IsMacOS())
            {
                return SetMacLaunchAgent(enabled, out message);
            }

            if (OperatingSystem.IsLinux())
            {
                return SetLinuxDesktopEntry(enabled, out message);
            }

            message = "当前平台不支持开机自启动";
            return false;
        }
        catch (Exception ex)
        {
            message = $"设置开机自启动失败：{ex.GetType().Name}";
            return false;
        }
    }

    [SupportedOSPlatform("windows")]
    private static bool SetWindowsRegistry(bool enabled, out string message)
    {
        const string runKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        using var key = Registry.CurrentUser.OpenSubKey(runKey, writable: true)
                        ?? Registry.CurrentUser.CreateSubKey(runKey, writable: true);

        if (key is null)
        {
            message = "无法打开 HKCU Run 注册表项";
            return false;
        }

        if (enabled)
        {
            key.SetValue(EntryName, RegistryCommandLine, RegistryValueKind.String);
            message = $"已写入注册表自启动项：{RegistryCommandLine}";
            return true;
        }

        if (key.GetValue(EntryName) is not null)
        {
            key.DeleteValue(EntryName, throwOnMissingValue: false);
        }

        message = "已移除注册表自启动项";
        return true;
    }

    private static bool SetMacLaunchAgent(bool enabled, out string message)
    {
        var path = AppPaths.LaunchAgentFile;
        if (!enabled)
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }

            message = "已移除 LaunchAgent plist（未验证）";
            return true;
        }

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var exe = Environment.ProcessPath ?? AppContext.BaseDirectory;
        var plist = $"""
            <?xml version="1.0" encoding="UTF-8"?>
            <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
            <plist version="1.0">
            <dict>
              <key>Label</key>
              <string>{MacLabel}</string>
              <key>ProgramArguments</key>
              <array>
                <string>{exe}</string>
              </array>
              <key>RunAtLoad</key>
              <true/>
              <key>KeepAlive</key>
              <false/>
            </dict>
            </plist>
            """;
        File.WriteAllText(path, plist);
        message = $"已写入 LaunchAgent：{path}（未验证，需 macOS 实机确认）";
        return true;
    }

    private static bool SetLinuxDesktopEntry(bool enabled, out string message)
    {
        var path = AppPaths.LinuxAutostartFile;
        if (!enabled)
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }

            message = "已移除 autostart .desktop（未验证）";
            return true;
        }

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var exe = Environment.ProcessPath ?? AppContext.BaseDirectory;
        var entry = $"""
            [Desktop Entry]
            Type=Application
            Name={AppInfo.Name}
            Comment={AppInfo.Slogan}
            Exec={exe}
            Terminal=false
            X-GNOME-Autostart-enabled=true
            """;
        File.WriteAllText(path, entry);
        message = $"已写入 autostart：{path}（未验证）";
        return true;
    }
}
