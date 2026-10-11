namespace Xideng.Desktop.Core;

/// <summary>
/// 设置仓库（对应 <c>packages/core/src/settings.js#createSettingsStore</c>）。
/// 任何写入都会先经过 <see cref="SettingsMigrator.Migrate"/>，保证磁盘上永远是合法结构。
/// </summary>
public sealed class SettingsStore
{
    /// <summary>存储键，与 Web 端 <c>localStorage</c> 的键名保持一致，便于跨端对照与迁移。</summary>
    public const string StorageKey = "xideng.settings.v1";

    private readonly IKeyValueStore _storage;
    private Settings _current;

    public SettingsStore(IKeyValueStore storage)
    {
        _storage = storage;
        var raw = SettingsMigrator.Deserialize(_storage.GetItem(StorageKey));
        _current = SettingsMigrator.Migrate(raw);

        // 首次读取即落一次迁移结果，保证磁盘上永远是当前版本的结构
        Persist();
    }

    /// <summary>设置变更通知。单个订阅者出错不影响其它订阅者。</summary>
    public event Action<Settings>? Changed;

    public Settings Value => _current;

    /// <summary>合并式更新：在现有值上做增量修改。</summary>
    public Settings Update(Action<Settings> mutate)
    {
        var working = _current.Clone();
        mutate(working);
        return Replace(working);
    }

    public Settings Replace(Settings next)
    {
        _current = SettingsMigrator.Migrate(next);
        Persist();
        Changed?.Invoke(_current);
        return _current;
    }

    public Settings Reset() => Replace(new Settings());

    private void Persist()
    {
        try
        {
            _storage.SetItem(StorageKey, SettingsMigrator.Serialize(_current));
        }
        catch (Exception)
        {
            // 文件不可写时退化为本次会话内有效，绝不因为磁盘问题让应用启动失败
        }
    }
}
