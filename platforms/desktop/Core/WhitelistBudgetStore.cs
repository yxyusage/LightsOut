using System.Text.Json;

namespace Xideng.Desktop.Core;

/// <summary>
/// 白名单共用时长预算（PRD 2.2.3 桌面端实现）。
///
/// 语义与 Web 端一致：所有白名单应用<b>共用</b>一个时长池（默认 30 分钟，上限 60 分钟），
/// 该池按"熄灯时段窗口"（<c>window.Start</c> 所在日期）重置——新一天进入熄灯即恢复满额。
/// 白名单应用在前台时持续消耗；剩余 0 时协调器强制恢复熄灯置顶。
/// 持久化到用户数据目录，重启设备后剩余额度依然有效。
/// </summary>
public sealed class WhitelistBudgetStore
{
    private readonly IKeyValueStore _storage;
    private readonly string _key;
    private readonly object _gate = new();

    private string _windowKey = string.Empty;
    private long _usedMs;

    public WhitelistBudgetStore(IKeyValueStore storage, string key = "whitelist-budget")
    {
        _storage = storage;
        _key = key;
        Load();
    }

    /// <summary>当前窗口内的剩余时长（毫秒）。窗口切换会自动清零已用。</summary>
    public long Remaining(DateTime now, string windowKey, long totalMs)
    {
        lock (_gate)
        {
            ResetIfWindowChanged(windowKey);
            return Math.Max(0, totalMs - _usedMs);
        }
    }

    /// <summary>消耗时长并返回剩余；窗口切换自动清零。deltaMs 为负时忽略。</summary>
    public long Consume(DateTime now, string windowKey, long totalMs, long deltaMs)
    {
        lock (_gate)
        {
            ResetIfWindowChanged(windowKey);
            if (deltaMs > 0)
            {
                _usedMs += deltaMs;
                Persist();
            }

            return Math.Max(0, totalMs - _usedMs);
        }
    }

    /// <summary>强制清零当前窗口已用（测试用 / 恢复默认）。</summary>
    public void Reset()
    {
        lock (_gate)
        {
            _windowKey = string.Empty;
            _usedMs = 0;
            Persist();
        }
    }

    private void ResetIfWindowChanged(string windowKey)
    {
        if (string.Equals(_windowKey, windowKey, StringComparison.Ordinal))
        {
            return;
        }

        _windowKey = windowKey;
        _usedMs = 0;
        Persist();
    }

    private void Load()
    {
        try
        {
            var json = _storage.GetItem(_key);
            if (string.IsNullOrWhiteSpace(json))
            {
                return;
            }

            using var doc = JsonDocument.Parse(json);
            _windowKey = doc.RootElement.TryGetProperty("windowKey", out var wk) ? wk.GetString() ?? string.Empty : string.Empty;
            _usedMs = doc.RootElement.TryGetProperty("usedMs", out var used) ? used.GetInt64() : 0;
            if (_usedMs < 0)
            {
                _usedMs = 0;
            }
        }
        catch (Exception)
        {
            // 数据损坏 → 视为零消耗
            _windowKey = string.Empty;
            _usedMs = 0;
        }
    }

    private void Persist()
    {
        try
        {
            var json = JsonSerializer.Serialize(new { windowKey = _windowKey, usedMs = _usedMs });
            _storage.SetItem(_key, json);
        }
        catch (Exception)
        {
            // 持久化失败不影响本次会话内生效
        }
    }
}
