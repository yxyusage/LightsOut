namespace Xideng.Desktop.Core;

/// <summary>
/// 极简键值存储接口，与 Web 端的 <c>localStorage</c> 形状保持一致，
/// 使 <see cref="QuotaStore"/> 等核心组件可以同时在桌面端（JSON 文件）与自检（内存）中运行。
/// </summary>
public interface IKeyValueStore
{
    /// <summary>读取；键不存在或数据损坏时返回 null，<b>绝不抛异常</b>。</summary>
    string? GetItem(string key);

    /// <summary>写入；失败时静默忽略（与 Web 端行为一致，不让存储问题锁死用户）。</summary>
    void SetItem(string key, string value);

    void RemoveItem(string key);
}

/// <summary>进程内存储，用于自检与"文件存储不可用"时的兜底。</summary>
public sealed class MemoryKeyValueStore : IKeyValueStore
{
    private readonly Dictionary<string, string> _map = new(StringComparer.Ordinal);
    private readonly object _gate = new();

    public MemoryKeyValueStore()
    {
    }

    public MemoryKeyValueStore(IEnumerable<KeyValuePair<string, string>> seed)
    {
        foreach (var pair in seed)
        {
            _map[pair.Key] = pair.Value;
        }
    }

    public string? GetItem(string key)
    {
        lock (_gate)
        {
            return _map.TryGetValue(key, out var value) ? value : null;
        }
    }

    public void SetItem(string key, string value)
    {
        lock (_gate)
        {
            _map[key] = value;
        }
    }

    public void RemoveItem(string key)
    {
        lock (_gate)
        {
            _map.Remove(key);
        }
    }

    /// <summary>便于自检断言。</summary>
    public IReadOnlyDictionary<string, string> Dump()
    {
        lock (_gate)
        {
            return new Dictionary<string, string>(_map, StringComparer.Ordinal);
        }
    }
}
