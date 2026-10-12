using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;

namespace Xideng.Desktop.Views;

/// <summary>
/// 滚轮式时间选择器（小时 / 分钟）：
/// 三格可见（上 / 中 / 下），中间为选中项并高亮放大，
/// 鼠标滚轮上下切换，每切换一格播放"咔哒"声（assets/audio/click.wav）。
/// 替代设置窗口里手动输入的 TextBox，避免 14 寸笔记本上反复敲键盘。
/// </summary>
public sealed class TimeWheel : UserControl
{
    private readonly Grid _grid;
    private readonly TextBlock _top = CreateItemText();
    private readonly TextBlock _mid = CreateItemText(active: true);
    private readonly TextBlock _bottom = CreateItemText();
    private string[] _items = [];
    private int _index;
    private DispatcherTimer? _animTimer;

    public const double CellHeight = 34;
    public const double WheelHeight = CellHeight * 3;

    /// <summary>选中项变化（参数为新索引）。</summary>
    public event Action<int>? ValueChanged;

    /// <summary>当前选中索引。</summary>
    public int Index => _index;

    /// <summary>当前选中项的文本（未设置候选时为空）。</summary>
    public string Current => _items.Length > 0 ? _items[_index] : "";

    public TimeWheel()
    {
        _grid = new Grid { RowDefinitions = new RowDefinitions("*,*,*") };
        Grid.SetRow(_top, 0);
        Grid.SetRow(_mid, 1);
        Grid.SetRow(_bottom, 2);
        _grid.Children.Add(_top);
        _grid.Children.Add(_mid);
        _grid.Children.Add(_bottom);

        Width = 72;
        Height = WheelHeight;
        ClipToBounds = true;
        Content = _grid;

        Focusable = true;
        PointerWheelChanged += OnPointerWheelChanged;
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

    /// <summary>设置候选列表与当前索引。</summary>
    public void SetItems(string[] items, int index)
    {
        _items = items ?? [];
        _index = Math.Clamp(index, 0, Math.Max(0, _items.Length - 1));
        Render();
    }

    /// <summary>外部跳转（如加载设置时），不播放咔哒声。</summary>
    public void SetIndex(int index, bool animate = true)
    {
        var next = Math.Clamp(index, 0, Math.Max(0, _items.Length - 1));
        if (next == _index)
        {
            return;
        }

        _index = next;
        if (animate)
        {
            PlayClick();
        }

        Render(animate);
        ValueChanged?.Invoke(_index);
    }

    private void OnPointerWheelChanged(object? sender, PointerWheelEventArgs e)
    {
        var delta = e.Delta.Y;
        if (delta > 0)
        {
            SetIndex(_index + 1);
        }
        else if (delta < 0)
        {
            SetIndex(_index - 1);
        }

        e.Handled = true;
    }

    private void Render(bool animate = false)
    {
        if (_items.Length == 0)
        {
            _top.Text = _mid.Text = _bottom.Text = "";
            return;
        }

        var prev = _items[Math.Clamp(_index - 1, 0, _items.Length - 1)];
        var current = _items[_index];
        var next = _items[Math.Clamp(_index + 1, 0, _items.Length - 1)];

        _top.Text = _index > 0 ? prev : "";
        _mid.Text = current;
        _bottom.Text = _index < _items.Length - 1 ? next : "";

        _top.Opacity = _index > 0 ? 0.75 : 0;
        _bottom.Opacity = _index < _items.Length - 1 ? 0.75 : 0;

        // 选中项轻微弹跳，增强"咔哒到位"的手感
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

    private static void PlayClick()
    {
        Platform.AudioService.PlayClick();
    }
}
