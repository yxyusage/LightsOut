using System.Text.Json;

namespace Xideng.Desktop.Core;

/// <summary>自然周工具。PRD 2.1.3 的"每周"以<b>周一 00:00 为界</b>。</summary>
public static class WeekUtil
{
    /// <summary>该日期所在自然周的周一 00:00（本地时区）。</summary>
    public static DateTime StartOfWeek(DateTime date)
    {
        var day = TimeUtil.StartOfDay(date);
        var offsetFromMonday = ((int)day.DayOfWeek + 6) % 7; // 周一 → 0，周日 → 6
        return TimeUtil.AddDays(day, -offsetFromMonday);
    }

    /// <summary>周键，例如 <c>"2026-08-31"</c>，表示 2026-08-31 那一周。</summary>
    public static string WeekKeyOf(DateTime date) => TimeUtil.DateKey(StartOfWeek(date));
}

public sealed record QuotaConsumeResult(bool Ok, int Remaining, string? Reason);

public sealed record QuotaSnapshot(string? WeekKey, int Total, int Used, int Remaining);

/// <summary>
/// 熄灯早睡 · 每周解除额度（<c>packages/core/src/quota.js</c> 的 C# 移植）。
///
/// PRD 2.1.3：每周提供 2 次紧急解除额度，自然周周一 0 点自动重置。
/// "自然周"按<b>周一 00:00 为起点</b>计算，因此直接把"该周周一的日期"当作周键，
/// 键一变即代表跨周，无需额外记录重置时间。
///
/// 存储损坏时<b>回退到满额度</b>，绝不因为存储异常把用户锁死。
/// </summary>
public sealed class QuotaStore
{
    private readonly IKeyValueStore _storage;
    private readonly string _key;
    private string? _weekKey;
    private int _used;
    private int _total;

    public QuotaStore(IKeyValueStore storage, string key = "quota", int total = Limits.WeeklyQuotaTotal)
    {
        _storage = storage;
        _key = key;
        _total = Math.Max(0, total);
        Load();
        if (_weekKey is null)
        {
            Persist();
        }
    }

    private void Load()
    {
        try
        {
            var raw = _storage.GetItem(_key);
            if (string.IsNullOrEmpty(raw))
            {
                return;
            }

            using var document = JsonDocument.Parse(raw);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return;
            }

            _weekKey = root.TryGetProperty("weekKey", out var weekKey) && weekKey.ValueKind == JsonValueKind.String
                ? weekKey.GetString()
                : null;
            _used = root.TryGetProperty("used", out var used) && used.ValueKind == JsonValueKind.Number
                ? Math.Max(0, used.GetInt32())
                : 0;
            if (root.TryGetProperty("total", out var total) && total.ValueKind == JsonValueKind.Number)
            {
                _total = Math.Max(0, total.GetInt32());
            }
        }
        catch (JsonException)
        {
            // 数据损坏时静默回退到全新状态，绝不因为存储异常把用户锁死
            _weekKey = null;
            _used = 0;
        }
    }

    private void Persist()
    {
        try
        {
            _storage.SetItem(_key, JsonSerializer.Serialize(new { weekKey = _weekKey, used = _used, total = _total }));
        }
        catch (Exception)
        {
            // 存储不可用时退化为本次会话内有效
        }
    }

    /// <summary>跨周则清零（PRD 2.1.3 的自然周重置）。返回是否发生了重置。</summary>
    public bool Sync(DateTime now)
    {
        var currentWeek = WeekUtil.WeekKeyOf(now);
        if (!string.Equals(_weekKey, currentWeek, StringComparison.Ordinal))
        {
            _weekKey = currentWeek;
            _used = 0;
            Persist();
            return true;
        }

        return false;
    }

    public int Total => _total;

    /// <summary>剩余次数。</summary>
    public int Remaining(DateTime now)
    {
        Sync(now);
        return Math.Max(0, _total - _used);
    }

    public bool IsAvailable(DateTime now) => Remaining(now) > 0;

    /// <summary>消费一次额度。</summary>
    public QuotaConsumeResult Consume(DateTime now)
    {
        Sync(now);
        if (_total - _used <= 0)
        {
            return new QuotaConsumeResult(false, 0, "本周解除额度已用完");
        }

        _used += 1;
        Persist();
        return new QuotaConsumeResult(true, Math.Max(0, _total - _used), null);
    }

    /// <summary>完整快照，供"个人中心"展示（PRD 2.1.3）。</summary>
    public QuotaSnapshot Snapshot(DateTime now)
    {
        Sync(now);
        return new QuotaSnapshot(_weekKey, _total, _used, Math.Max(0, _total - _used));
    }

    /// <summary>测试与"重置本周额度"调试入口使用。</summary>
    public void Reset(DateTime now)
    {
        _weekKey = WeekUtil.WeekKeyOf(now);
        _used = 0;
        Persist();
    }

    public void SetTotal(int nextTotal)
    {
        _total = Math.Max(0, nextTotal);
        Persist();
    }
}
