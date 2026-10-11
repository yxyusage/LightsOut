using System.Security.Cryptography;
using System.Text;

namespace Xideng.Desktop.Core;

/// <summary>
/// 熄灯早睡 · 紧急解除密码（<c>packages/core/src/password.js</c> 的 C# 移植）。
///
/// 定位说明（请勿误读为安全机制）：PRD 2.2.5 的密码是<b>防冲动的一次减速带</b>，
/// 挡住的是"半夜手滑想退出"的瞬时决定，不是攻击者。密码哈希与全部设置一样
/// 只存在用户本机，本应用不获取、不上传（PRD 六、隐私安全）。
///
/// 因此这里使用固定的域分隔前缀 + SHA-256，而<b>不做</b>慢哈希 / KDF：
/// 引入盐值存储与迭代参数只会增加复杂度，却挡不住能读到本地设置文件的人。
/// 这个取舍是有意为之，且与 Web 端产生的摘要<b>跨端一致</b>。
/// </summary>
public static class PasswordHasher
{
    /// <summary>与 Web 端严格一致的域分隔前缀；改动会导致两端密码不通用。</summary>
    public const string DomainPrefix = "xideng::emergency::v1";

    /// <summary>
    /// 计算密码摘要（小写十六进制 SHA-256）。
    /// Web 端用 <c>TextEncoder</c>（即 UTF-8）编码，这里用 <see cref="Encoding.UTF8"/>，两端结果相同。
    /// </summary>
    public static string Hash(string? password)
    {
        var payload = $"{DomainPrefix}|{password ?? string.Empty}";
        var bytes = Encoding.UTF8.GetBytes(payload);
        var digest = SHA256.HashData(bytes);
        return Convert.ToHexString(digest).ToLowerInvariant();
    }

    /// <summary>
    /// 校验密码。<paramref name="expectedHash"/> 为空字符串表示尚未设置密码，永远返回 false。
    /// 比较使用固定时间实现，避免提前返回造成的时长差异。
    /// </summary>
    public static bool Verify(string? password, string? expectedHash)
    {
        if (string.IsNullOrEmpty(expectedHash))
        {
            return false;
        }

        var actual = Hash(password);
        if (actual.Length != expectedHash.Length)
        {
            return false;
        }

        var diff = 0;
        for (var i = 0; i < actual.Length; i++)
        {
            diff |= actual[i] ^ expectedHash[i];
        }

        return diff == 0;
    }

    /// <summary>密码强度提示，用于首次引导界面（返回人类可读的建议，空列表表示合格）。</summary>
    public static IReadOnlyList<string> Advice(string? password)
    {
        var text = password ?? string.Empty;
        var advice = new List<string>();
        if (text.Length < 4)
        {
            advice.Add("至少 4 位");
        }

        if (text.Length > 0 && text.All(char.IsAsciiDigit))
        {
            advice.Add("纯数字容易误触通过，建议混合字母");
        }

        if (text.Length > 32)
        {
            advice.Add("不要超过 32 位，以免难以输入");
        }

        return advice;
    }
}
