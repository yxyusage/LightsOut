using System.Text.Json;
using Xideng.Desktop.Core;

namespace Xideng.Desktop.Platform;

/// <summary>
/// 跨平台用户数据目录（PRD 六、隐私安全："所有设置数据本地存储，不上传用户隐私"）。
///
/// <list type="bullet">
///   <item>Windows：<c>%APPDATA%\xideng\</c></item>
///   <item>macOS：<c>~/Library/Application Support/xideng/</c></item>
///   <item>Linux：<c>$XDG_CONFIG_HOME/xideng/</c> 或 <c>~/.config/xideng/</c></item>
/// </list>
///
/// 注意：.NET 的 <c>SpecialFolder.ApplicationData</c> 在 macOS 上返回 <c>~/.config</c>，
/// 而 macOS 惯例是 <c>~/Library/Application Support</c>，因此必须对 macOS 单独分支处理。
/// </summary>
public static class AppPaths
{
    public const string FolderName = "xideng";

    private static readonly Lazy<string> LazyUserDataDir = new(ResolveUserDataDir);

    public static string UserDataDir => LazyUserDataDir.Value;

    public static string SettingsFile => Path.Combine(UserDataDir, "settings.json");

    public static string QuotaFile => Path.Combine(UserDataDir, "quota.json");

    public static string ViolationsFile => Path.Combine(UserDataDir, "violations.json");

    public static string SelfTestReportFile => Path.Combine(UserDataDir, "selftest-report.txt");

    public static string LaunchAgentFile => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        "Library",
        "LaunchAgents",
        $"com.{FolderName}.desktop.plist");

    public static string LinuxAutostartFile => Path.Combine(
        LinuxConfigHome(),
        "autostart",
        $"{FolderName}-desktop.desktop");

    private static string ResolveUserDataDir()
    {
        if (OperatingSystem.IsMacOS())
        {
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(home, "Library", "Application Support", FolderName);
        }

        if (OperatingSystem.IsWindows())
        {
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            return Path.Combine(appData, FolderName);
        }

        return Path.Combine(LinuxConfigHome(), FolderName);
    }

    private static string LinuxConfigHome()
    {
        var xdg = Environment.GetEnvironmentVariable("XDG_CONFIG_HOME");
        if (!string.IsNullOrWhiteSpace(xdg))
        {
            return xdg;
        }

        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config");
    }

    /// <summary>确保目录存在；失败时返回 false（不抛异常）。</summary>
    public static bool EnsureUserDataDir()
    {
        try
        {
            Directory.CreateDirectory(UserDataDir);
            return true;
        }
        catch (Exception)
        {
            return false;
        }
    }
}

/// <summary>
/// 以单个 JSON 对象文件承载键值对（键 → 字符串值）的存储实现。
/// 读取永远不抛异常；损坏时视为空存储，保证应用始终能启动。
/// </summary>
public sealed class JsonFileKeyValueStore : IKeyValueStore
{
    private readonly string _path;
    private readonly object _gate = new();
    private Dictionary<string, string>? _cache;

    public JsonFileKeyValueStore(string path)
    {
        _path = path;
    }

    public string? GetItem(string key)
    {
        lock (_gate)
        {
            var map = Load();
            return map.TryGetValue(key, out var value) ? value : null;
        }
    }

    public void SetItem(string key, string value)
    {
        lock (_gate)
        {
            var map = Load();
            map[key] = value;
            Save(map);
        }
    }

    public void RemoveItem(string key)
    {
        lock (_gate)
        {
            var map = Load();
            if (map.Remove(key))
            {
                Save(map);
            }
        }
    }

    private Dictionary<string, string> Load()
    {
        if (_cache is not null)
        {
            return _cache;
        }

        try
        {
            if (File.Exists(_path))
            {
                var json = File.ReadAllText(_path);
                var parsed = JsonSerializer.Deserialize<Dictionary<string, string>>(json);
                if (parsed is not null)
                {
                    _cache = new Dictionary<string, string>(parsed, StringComparer.Ordinal);
                    return _cache;
                }
            }
        }
        catch (Exception)
        {
            // 数据损坏 → 当作空存储处理
        }

        _cache = new Dictionary<string, string>(StringComparer.Ordinal);
        return _cache;
    }

    private void Save(Dictionary<string, string> map)
    {
        try
        {
            AppPaths.EnsureUserDataDir();
            var json = JsonSerializer.Serialize(map, new JsonSerializerOptions
            {
                WriteIndented = true,
                Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            });
            File.WriteAllText(_path, json);
        }
        catch (Exception)
        {
            // 写入失败时保留内存缓存，退化为会话内有效
        }
    }
}
