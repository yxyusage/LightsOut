namespace Xideng.Desktop.Core;

public sealed record ClockJumpEvent(long DriftMs, string Direction, DateTimeOffset At);

public sealed record TapResult(bool Triggered, int Progress, int Remaining);

/// <summary>
/// 系统时间篡改检测（PRD 三「防系统时间篡改」）。
///
/// 用单调时钟（<see cref="System.Diagnostics.Stopwatch"/>）作为参照，若墙上时钟与单调时钟的
/// 增量出现明显偏差，说明用户改了系统时间：向前改可能是想跳过熄灯时段，向后改可能是想重复触发，
/// 两者都要拦。<b>行为与 Web 端 <c>guard.js#createClockGuard</c> 一致。</b>
/// </summary>
public sealed class ClockGuard
{
    private readonly Func<long> _wall;
    private readonly Func<long> _monotonic;
    private readonly long _toleranceMs;
    private readonly Action<ClockJumpEvent>? _onJump;

    private long _lastWall;
    private long _lastMonotonic;

    public ClockGuard(
        Func<long>? wall = null,
        Func<long>? monotonic = null,
        long toleranceMs = Limits.ClockTamperToleranceMs,
        Action<ClockJumpEvent>? onJump = null)
    {
        _wall = wall ?? (() => DateTimeOffset.Now.ToUnixTimeMilliseconds());
        _monotonic = monotonic ?? (() => Environment.TickCount64);
        _toleranceMs = toleranceMs;
        _onJump = onJump;
        Reset();
    }

    /// <summary>取一次样本；没有异常返回 null。</summary>
    public ClockJumpEvent? Sample()
    {
        var wall = _wall();
        var mono = _monotonic();
        var drift = (wall - _lastWall) - (mono - _lastMonotonic);

        _lastWall = wall;
        _lastMonotonic = mono;

        if (Math.Abs(drift) <= _toleranceMs)
        {
            return null;
        }

        var jump = new ClockJumpEvent(
            drift,
            drift > 0 ? "forward" : "backward",
            DateTimeOffset.FromUnixTimeMilliseconds(wall));
        _onJump?.Invoke(jump);
        return jump;
    }

    public void Reset()
    {
        _lastWall = _wall();
        _lastMonotonic = _monotonic();
    }
}

/// <summary>
/// 连续点击计数器（PRD 2.2.5：连续点击屏幕 5 次触发紧急解除入口）。
/// 超出时间窗则重新计数，避免用户零散点击意外触发。
/// 行为与 Web 端 <c>guard.js#createTapCounter</c> 一致。
/// </summary>
public sealed class TapCounter
{
    private readonly int _required;
    private readonly long _windowMs;
    private readonly Func<long> _now;
    private readonly Action? _onTrigger;
    private readonly List<long> _timestamps = [];

    public TapCounter(int required = Limits.EmergencyTapCount, long windowMs = Limits.EmergencyTapWindowMs, Func<long>? now = null, Action? onTrigger = null)
    {
        _required = required;
        _windowMs = windowMs;
        _now = now ?? (() => Environment.TickCount64);
        _onTrigger = onTrigger;
    }

    public int Progress => _timestamps.Count;

    public TapResult Tap()
    {
        var current = _now();
        _timestamps.RemoveAll(time => current - time > _windowMs);
        _timestamps.Add(current);

        if (_timestamps.Count >= _required)
        {
            _timestamps.Clear();
            _onTrigger?.Invoke();
            return new TapResult(true, 0, _required);
        }

        return new TapResult(false, _timestamps.Count, _required - _timestamps.Count);
    }

    public void Reset() => _timestamps.Clear();
}
