using System.Runtime.InteropServices;
using Avalonia.Platform;

namespace Xideng.Desktop.Platform;

/// <summary>
/// 桌面端助眠音频（PRD 2.3）。
///
/// 实现策略：把内置的白噪音 wav（雨声 / 海浪 / 溪流）作为 AvaloniaResource 打包，
/// 首次播放时解包到用户数据目录缓存，再用 winmm <c>PlaySound</c> 以
/// SND_ASYNC | SND_LOOP 循环播放。这样单文件 EXE 也能正常工作，不引入任何第三方包。
/// </summary>
public static class AudioService
{
    private const uint SndAsync = 0x0001;
    private const uint SndLoop = 0x0008;
    private const uint SndFilename = 0x00020000;
    private const uint SndPurge = 0x0040;

    [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
    private static extern bool PlaySound(string? sound, nint module, uint flags);

    /// <summary>内置预设：id → 资源名 / 显示名。音频时长 8 秒，PlaySound 无缝循环。</summary>
    public static readonly (string Id, string Name, string Asset)[] Presets =
    [
        ("rain", "雨声", "avares://Xideng.Desktop/assets/audio/rain.wav"),
        ("waves", "海浪", "avares://Xideng.Desktop/assets/audio/waves.wav"),
        ("stream", "溪流", "avares://Xideng.Desktop/assets/audio/stream.wav"),
    ];

    private static string? _currentFile;

    public static string? CurrentPresetId { get; private set; }

    /// <summary>解包资源到缓存目录（存在即跳过），返回本地文件路径。</summary>
    public static string? ExtractToCache(string presetId)
    {
        var preset = Presets.FirstOrDefault(item => item.Id == presetId);
        if (preset.Id is null)
        {
            return null;
        }

        try
        {
            var cacheDir = Path.Combine(AppPaths.UserDataDir, "audio");
            Directory.CreateDirectory(cacheDir);
            var target = Path.Combine(cacheDir, $"{presetId}.wav");
            if (File.Exists(target) && new FileInfo(target).Length > 0)
            {
                return target;
            }

            using var stream = AssetLoader.Open(new Uri(preset.Asset));
            using var output = File.Create(target);
            stream.CopyTo(output);
            return target;
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>循环播放指定预设；返回是否成功启动。</summary>
    public static bool Play(string presetId)
    {
        var file = ExtractToCache(presetId);
        if (file is null)
        {
            return false;
        }

        Stop();
        var ok = PlaySound(file, nint.Zero, SndAsync | SndLoop | SndFilename);
        if (ok)
        {
            _currentFile = file;
            CurrentPresetId = presetId;
        }
        return ok;
    }

    /// <summary>停止当前播放。</summary>
    public static void Stop()
    {
        if (_currentFile is not null || CurrentPresetId is not null)
        {
            PlaySound(null, nint.Zero, SndPurge);
            _currentFile = null;
            CurrentPresetId = null;
        }
    }

    /// <summary>
    /// 播放一次"咔哒"声（滚轮换挡提示）。
    /// 注：winmm 同一时刻只播一个声音，因此本方法会取代正在播放的循环音频；
    /// 实际场景中滚轮只出现在设置窗口、白噪音只出现在熄灯窗口，两者互不重叠。
    /// </summary>
    public static void PlayClick()
    {
        try
        {
            var cacheDir = Path.Combine(AppPaths.UserDataDir, "audio");
            Directory.CreateDirectory(cacheDir);
            var target = Path.Combine(cacheDir, "click.wav");
            if (!File.Exists(target) || new FileInfo(target).Length == 0)
            {
                using var stream = AssetLoader.Open(new Uri("avares://Xideng.Desktop/assets/audio/click.wav"));
                using var output = File.Create(target);
                stream.CopyTo(output);
            }

            PlaySound(target, nint.Zero, SndAsync | SndFilename);
        }
        catch (Exception)
        {
            // 无声失败不影响滚轮操作
        }
    }
}
