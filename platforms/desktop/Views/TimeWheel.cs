using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Xideng.Desktop.Core;

namespace Xideng.Desktop.Views;

/// <summary>
/// 滚轮式时间选择器 v2（时 / 分两列分开）：
/// <list type="bullet">
///   <item>小时轮 00–23、分钟轮 00–59，<b>精确到每分钟</b>（不再 5 分钟步进）；</item>
///   <item>鼠标滚轮逐格切换，每格"咔哒"声 + 选中项弹跳；</item>
///   <item><b>键盘直输数字</b>：聚焦某列后敲 0–9 直接改值，两位自动组合
///       （如敲 2 再敲 3 → 23；敲 0 再敲 7 → 07），超出范围（≥24/≥60）自动回落；</item>
///   <item>Tab / 左右方向键在两列间切换焦点，聚焦列中间项带高亮描边；</item>
///   <item>黑灰风格，与设置窗口整体一致。</item>
/// </list>
/// </summary>
public sealed class TimeWheel : UserControl
{
    private readonly WheelColumn _hourColumn;
    private readonly WheelColumn _minuteColumn;
    private WheelColumn _focused;

    /// <summary>值变化（用户操作时触发；SetValue 不触发）。</summary>
    public event Action? ValueChanged;

    public TimeWheel()
    {
        _hourColumn = new WheelColumn(0, 23, onChanged: () => ValueChanged?.Invoke());
        _minuteColumn = new WheelColumn(0, 59, onChanged: () => ValueChanged?.Invoke());

        var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("72,16,72") };
        Grid.SetColumn(_hourColumn, 0);
        Grid.SetColumn(_minuteColumn, 2);
        grid.Children.Add(_hourColumn);
        grid.Children.Add(new TextBlock
        {
            Text = ":",
            FontSize = 24,
            Foreground = new SolidColorBrush(Color.Parse("#8A8A8A")),
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        grid.Children.Add(_minuteColumn);

        Width = 160;
        Height = WheelColumn.WheelHeight;
        ClipToBounds = true;
        Content = grid;

        _focused = _hourColumn;
        _hourColumn.IsActiveFocus = true;
        Focusable = true;

        // 焦点切换：Tab / 左右方向键
        KeyDown += (_, e) =>
        {
            if (e.Key == Key.Tab || e.Key == Key.Right || e.Key == Key.Left)
            {
                FocusNextColumn(e.Key == Key.Left ? -1 : 1);
                e.Handled = true;
            }
        };
    }

    /// <summary>当前选中时间（HH:MM）。</summary>
    public string Current => $"{_hourColumn.Value:00}:{_minuteColumn.Value:00}";

    /// <summary>外部设置（加载设置时用，不触发 ValueChanged、不播咔哒）。</summary>
    public void SetValue(string? hhmm)
    {
        if (TimeUtil.TryToMinutes(hhmm, out var minutes))
        {
            _hourColumn.SetValue(minutes / 60, quiet: true);
            _minuteColumn.SetValue(minutes % 60, quiet: true);
        }
    }

    protected override void OnGotFocus(GotFocusEventArgs e)
    {
        base.OnGotFocus(e);
        _focused.FocusSelf();
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);

        if (e.Key is >= Key.D0 and <= Key.D9)
        {
            _focused.HandleDigit(e.Key - Key.D0);
            e.Handled = true;
            return;
        }

        if (e.Key is >= Key.NumPad0 and <= Key.NumPad9)
        {
            _focused.HandleDigit(e.Key - Key.NumPad0);
            e.Handled = true;
        }
    }

    private void FocusNextColumn(int direction)
    {
        _focused.IsActiveFocus = false;
        _focused = direction < 0 ? _hourColumn : _minuteColumn;
        _focused.IsActiveFocus = true;
        _focused.RenderAll();
        _focused.FocusSelf();
    }
}

/// <summary>
/// 单个数字滚轮列：三格可见（上 / 中 / 下），中间选中项高亮放大；
/// 鼠标滚轮逐格切换（每格咔哒声 + 弹跳）；键盘数字直输。
/// </summary>
internal sealed class WheelColumn : UserControl
{
    private readonly int _min;
    private readonly int _max;
    private readonly Action _onChanged;
    private readonly TextBlock _top = CreateItemText();
    private readonly TextBlock _mid = CreateItemText(active: true);
    private readonly TextBlock _bottom = CreateItemText();
    private readonly Border _midFrame;
    private readonly Grid _grid;
    private DispatcherTimer? _animTimer;
    private DispatcherTimer? _pendingTimer;
    private int? _pendingDigit;

    public const double CellHeight = 34;
    public const double WheelHeight = CellHeight * 3;

    public int Value { get; private set; }

    public bool IsActiveFocus { get; set; }

    public WheelColumn(int min, int max, Action onChanged)
    {
        _min = min;
        _max = max;
        _onChanged = onChanged;
        Value = min;

        _midFrame = new Border
        {
            Child = _mid,
            BorderBrush = new SolidColorBrush(Color.Parse("#2E2E2E")),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            MinWidth = 52,
            Height = CellHeight,
        };

        _grid = new Grid { RowDefinitions = new RowDefinitions("*,*,*") };
        Grid.SetRow(_top, 0);
        Grid.SetRow(_midFrame, 1);
        Grid.SetRow(_bottom, 2);
        _grid.Children.Add(_top);
        _grid.Children.Add(_midFrame);
        _grid.Children.Add(_bottom);

        Width = 72;
        Height = WheelHeight;
        ClipToBounds = true;
        Content = _grid;

        Focusable = true;
        PointerWheelChanged += OnPointerWheelChanged;
        PointerPressed += (_, _) => FocusSelf();
    }

    private static TextBlock CreateItemText(bool active = false)
    {
        return new TextBlock
        {
            FontSize = active ? 24 : 15,
            FontWeight = active ? FontWeight.Medium : FontWeight.Light,
            Foreground = new SolidColorBrush(active ? Color.Parse("#E8E8E8") : Color.Parse("#6E6E6E")),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
    }

    public void SetValue(int value, bool quiet)
    {
        Value = Math.Clamp(value, _min, _max);
        Render(animate: false);
        if (!quiet)
        {
            _onChanged();
        }
    }

    /// <summary>重新渲染焦点样式（切换聚焦列时）。</summary>
    public void RenderAll() => Render(animate: false);

    /// <summary>键盘数字直输：先敲的为十位，再敲的第二位自动组合；超时则单位数生效。</summary>
    public void HandleDigit(int digit)
    {
        if (_pendingDigit is int tens)
        {
            var composed = tens * 10 + digit;
            SetValue(composed <= _max ? composed : digit, quiet: false);
            ClearPending();
            return;
        }

        // 首位：先按单位数生效（如敲 7 → 07），等待第二位组合
        SetValue(digit, quiet: false);
        _pendingDigit = digit;
        _pendingTimer?.Stop();
        _pendingTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1400) };
        _pendingTimer.Tick += (_, _) => ClearPending();
        _pendingTimer.Start();
        Platform.AudioService.PlayClick();
        _onChanged();
    }

    private void ClearPending()
    {
        _pendingDigit = null;
        _pendingTimer?.Stop();
        _pendingTimer = null;
    }

    public void FocusSelf()
    {
        Focus();
        IsActiveFocus = true;
        Render(animate: false);
    }

    private void OnPointerWheelChanged(object? sender, PointerWheelEventArgs e)
    {
        var delta = e.Delta.Y;
        if (delta > 0)
        {
            Step(+1);
        }
        else if (delta < 0)
        {
            Step(-1);
        }

        e.Handled = true;
    }

    private void Step(int direction)
    {
        var next = Math.Clamp(Value + direction, _min, _max);
        if (next == Value)
        {
            return;
        }

        SetValue(next, quiet: false);
        Platform.AudioService.PlayClick();
    }

    private void Render(bool animate)
    {
        _top.Text = Value > _min ? $"{Value - 1:00}" : "";
        _mid.Text = $"{Value:00}";
        _bottom.Text = Value < _max ? $"{Value + 1:00}" : "";

        _top.Opacity = Value > _min ? 0.75 : 0;
        _bottom.Opacity = Value < _max ? 0.75 : 0;

        // 聚焦列：中间选中框高亮描边（键盘输入提示）
        _midFrame.BorderBrush = new SolidColorBrush(IsActiveFocus ? Color.Parse("#5A5A5A") : Color.Parse("#2E2E2E"));
        _mid.Foreground = new SolidColorBrush(IsActiveFocus ? Color.Parse("#FFFFFF") : Color.Parse("#E8E8E8"));

        if (animate)
        {
            _mid.RenderTransform = new ScaleTransform(1.18, 1.18);
            _mid.RenderTransformOrigin = new RelativePoint(0.5, 0.5, RelativeUnit.Relative);
            _animTimer?.Stop();
            _animTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(70) };
            _animTimer.Tick += (_, _) =>
            {
                _mid.RenderTransform = null;
                _animTimer?.Stop();
                _animTimer = null;
            };
            _animTimer.Start();
        }
        else
        {
            _mid.RenderTransform = null;
        }
    }
}
