using System.Diagnostics;
using System.IO;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Platform.Storage;
using Xideng.Desktop.Platform;

namespace Xideng.Desktop.Views;

/// <summary>进程选择结果。</summary>
public sealed record ProcessPickResult(string Name, string ProcessName);

/// <summary>进程选择列表展示项（窗口标题 + 说明）。</summary>
public sealed record ProcessItem(string Name, string ProcessName, string Detail);

/// <summary>
/// 白名单应用的"傻瓜式"添加窗口（对小白友好，无需记进程名）：
/// <list type="bullet">
///   <item>列出当前正在运行且有主窗口的应用（显示窗口标题 + 进程名），双击或选中后添加；</item>
///   <item>"浏览程序文件…"用系统文件对话框选 .exe，自动取进程名（文件名去扩展名）；</item>
///   <item>上限 3 个由调用方在添加前校验，本窗口只负责挑选。</item>
/// </list>
/// </summary>
public partial class ProcessPickerWindow : Window
{
    private ProcessPickResult? _selected;

    public ProcessPickerWindow()
    {
        InitializeComponent();

        AddButton.Click += (_, _) => ConfirmSelection();
        CancelButton.Click += (_, _) => Close(null);
        BrowseButton.Click += (_, _) => BrowseExecutable();
        ProcessList.DoubleTapped += (_, _) => ConfirmSelection();
        ProcessList.SelectionChanged += (_, _) => RefreshSelected();
    }

    /// <summary>启动时由调用方设置当前已用名额（显示在提示行）。</summary>
    public int UsedSlots { get; set; } = 0;

    protected override void OnOpened(EventArgs e)
    {
        base.OnOpened(e);
        RefreshProcessList();
        PickerHint.Text = $"双击列表项直接添加；也可以点击下方按钮浏览 .exe 文件。白名单最多 3 个用户应用（当前已用 {UsedSlots} 个）。";
    }

    private void RefreshProcessList()
    {
        var self = Process.GetCurrentProcess().ProcessName;
        var items = new List<ProcessItem>();

        try
        {
            foreach (var process in Process.GetProcesses())
            {
                if (process.ProcessName.Equals(self, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                try
                {
                    if (process.MainWindowHandle == nint.Zero)
                    {
                        continue;
                    }

                    var title = process.MainWindowTitle;
                    if (string.IsNullOrWhiteSpace(title))
                    {
                        continue;
                    }

                    items.Add(new ProcessItem(
                        title.Length > 40 ? title[..40] : title,
                        process.ProcessName,
                        process.ProcessName));
                }
                catch (Exception)
                {
                    // 个别系统进程访问不到主窗口信息，跳过
                }
            }
        }
        catch (Exception)
        {
            // 枚举进程失败时列表为空，用户仍可用"浏览程序文件"
        }

        items = items
            .GroupBy(item => item.ProcessName, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        ProcessList.ItemsSource = items;
    }

    private void RefreshSelected()
    {
        if (ProcessList.SelectedItem is ProcessItem item)
        {
            _selected = new ProcessPickResult(item.Name, item.ProcessName);
        }
        else
        {
            _selected = null;
        }
    }

    private void ConfirmSelection()
    {
        if (_selected is null)
        {
            PickerHint.Text = "请先在列表中选择一个应用，或点击「浏览程序文件…」。";
            return;
        }

        Close(_selected);
    }

    private async void BrowseExecutable()
    {
        try
        {
            var files = await StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
            {
                Title = "选择要放行的程序（.exe）",
                AllowMultiple = false,
                FileTypeFilter =
                [
                    new FilePickerFileType("应用程序") { Patterns = ["*.exe"] },
                    new FilePickerFileType("所有文件") { Patterns = ["*"] },
                ],
            });

            if (files.Count == 0)
            {
                return;
            }

            var path = files[0].TryGetLocalPath();
            if (string.IsNullOrWhiteSpace(path))
            {
                PickerHint.Text = "无法读取所选文件的路径。";
                return;
            }

            var fileName = Path.GetFileNameWithoutExtension(path);
            var result = new ProcessPickResult(
                fileName.Length > 40 ? fileName[..40] : fileName,
                fileName);
            Close(result);
        }
        catch (Exception)
        {
            PickerHint.Text = "打开文件选择器失败，请改用上方列表点选。";
        }
    }
}
