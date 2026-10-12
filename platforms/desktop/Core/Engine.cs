namespace Xideng.Desktop.Core;

/// <summary>引擎快照，UI 每帧消费它。</summary>
public sealed class EngineSnapshot
{
    public DateTime At { get; init; }

    public Settings Settings { get; init; } = new();

    public SceneInfo Scene { get; init; } = new();

    public QuotaSnapshot Quota { get; init; } = new(null, 0, 0, 0);

    public string Phase { get; init; } = Core.Phase.Off;

    public ScheduleWindow? Window { get; init; }

    public long RemainingMs { get; init; }

    public long WarnMs { get; init; }

    public bool Dismissed { get; init; }

    public string? DismissedWindowKey { get; init; }

    public CopyEntry Copy { get; init; } = new("none", "comfort", string.Empty);

    public int CopyIntervalMs { get; init; } = Limits.CopyRotateMs;

    public int CopyTotal { get; init; }
}

public sealed record UnlockResult(bool Ok, int Remaining, string? Reason);

/// <summary>
/// 熄灯早睡 · 状态引擎（<c>packages/core/src/engine.js</c> 的 C# 移植）。
///
/// 把"计划 + 场景 + 文案 + 额度 + 紧急解除"组合成一个可被 UI 消费的快照。
/// 引擎自身<b>不持有定时器、不接触 UI、不读系统时间</b>，因此自检可以任意"穿越时间"驱动它。
/// </summary>
public sealed class Engine
{
    private readonly SettingsStore _settingsStore;
    private readonly QuotaStore _quotaStore;

    /// <summary>被紧急解除的时段键（该时段开始日的 YYYY-MM-DD）；null 表示未解除。</summary>
    private string? _dismissedWindowKey;

    private List<CopyEntry>? _playlist;
    private string? _playlistKey;
    private CopyRotator? _rotator;

    /// <summary>AI 生成的文案，优先级高于本地轮播。</summary>
    private string? _aiText;

    public Engine(SettingsStore settingsStore, QuotaStore quotaStore)
    {
        _settingsStore = settingsStore;
        _quotaStore = quotaStore;
    }

    private void EnsurePlaylist(SceneInfo scene)
    {
        var key = $"{scene.DateKey}|{scene.Scene}";
        if (string.Equals(key, _playlistKey, StringComparison.Ordinal) && _rotator is not null)
        {
            return;
        }

        var configuredMs = _settingsStore.Value.Blackout.CopyIntervalSec * 1000.0;
        var interval = configuredMs > 0 ? (int)configuredMs : Limits.CopyRotateMs;

        _playlist = CopyLibrary.BuildPlaylist(scene, CopyLibrary.HashString(key));
        _rotator = new CopyRotator(_playlist, interval);
        _playlistKey = key;
    }

    /// <summary>当前状态快照。UI 每一帧都调用它。</summary>
    public EngineSnapshot Snapshot(DateTime now)
    {
        var settings = _settingsStore.Value;
        var phaseInfo = ScheduleEngine.PhaseAt(
            settings.Plan,
            now,
            settings.Plan.WarnMinutes,
            _dismissedWindowKey,
            sundayAsWeekday: settings.Plan.SundayAsWeekday);
        var scene = SceneDetector.Detect(now);
        EnsurePlaylist(scene);

        var copy = _aiText is not null
            ? new CopyEntry("ai", "ai", _aiText, "ai")
            : _rotator!.Current;

        return new EngineSnapshot
        {
            At = now,
            Settings = settings,
            Scene = scene,
            Quota = _quotaStore.Snapshot(now),
            Phase = phaseInfo.Phase,
            Window = phaseInfo.Window,
            RemainingMs = phaseInfo.RemainingMs,
            WarnMs = phaseInfo.WarnMs,
            Dismissed = phaseInfo.Dismissed,
            DismissedWindowKey = _dismissedWindowKey,
            Copy = copy,
            CopyIntervalMs = _rotator!.IntervalMs,
            CopyTotal = _rotator.Count,
        };
    }

    /// <summary>推进到下一句文案（由 UI 的定时器调用）。</summary>
    public CopyEntry RotateCopy(DateTime now)
    {
        if (_rotator is null)
        {
            EnsurePlaylist(SceneDetector.Detect(now));
        }

        return _rotator!.Next();
    }

    /// <summary>跳回播放列表开头（重新进入熄灯模式时调用，保证每次从第一句开始）。</summary>
    public CopyEntry ResetCopy(DateTime now)
    {
        if (_rotator is null)
        {
            EnsurePlaylist(SceneDetector.Detect(now));
        }

        return _playlist is { Count: > 0 } ? _rotator!.JumpTo(_playlist[0].Id) : _rotator!.Current;
    }

    /// <summary>注入 AI 文案；传 null 恢复本地轮播。</summary>
    public string? SetAiText(string? text)
    {
        _aiText = string.IsNullOrWhiteSpace(text) ? null : text.Trim();
        return _aiText;
    }

    public string? AiText => _aiText;

    public IReadOnlyList<CopyEntry>? Playlist => _playlist;

    public string? DismissedWindowKey => _dismissedWindowKey;

    /// <summary>
    /// 紧急解除（PRD 2.2.5）。
    /// 校验顺序刻意设计为<b>「先密码、后额度」</b>——密码错误不应消耗用户宝贵的解除次数。
    /// </summary>
    public UnlockResult EmergencyUnlock(string password, DateTime now)
    {
        var settings = _settingsStore.Value;

        if (string.IsNullOrEmpty(settings.Emergency.PasswordHash))
        {
            return new UnlockResult(false, 0, "no-password");
        }

        var phaseInfo = ScheduleEngine.PhaseAt(
            settings.Plan,
            now,
            settings.Plan.WarnMinutes,
            _dismissedWindowKey,
            sundayAsWeekday: settings.Plan.SundayAsWeekday);
        if (phaseInfo.Phase != Core.Phase.Active)
        {
            return new UnlockResult(false, 0, "not-active");
        }

        if (!PasswordHasher.Verify(password, settings.Emergency.PasswordHash))
        {
            return new UnlockResult(false, 0, "bad-password");
        }

        var consumed = _quotaStore.Consume(now);
        if (!consumed.Ok)
        {
            return new UnlockResult(false, 0, "quota-exhausted");
        }

        // 只解除"当前这一次"时段，次日计划照常生效
        _dismissedWindowKey = phaseInfo.Window?.StartKey;
        return new UnlockResult(true, consumed.Remaining, null);
    }

    /// <summary>重新武装（跨时段或用户手动恢复计划时调用）。</summary>
    public void Rearm() => _dismissedWindowKey = null;
}
