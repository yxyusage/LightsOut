/**
 * 主页：状态卡 + 睡眠时段 + 白名单 + 助眠音频 + AI 配置入口。
 */

import { AUDIO_PRESETS, DAY_TYPE, WARN_MINUTE_OPTIONS } from "../core.js";
import { el, replaceChildren, setHidden, setText, toggleClass } from "../lib/dom.js";
import { createChipGroup, createWindowEditor, describeWindow, requireElement } from "./controls.js";

export function createHomeView(ctx) {
  const { core, settingsStore, actions } = ctx;

  const els = {
    dot: requireElement("#status-dot"),
    label: requireElement("#status-label"),
    detail: requireElement("#status-detail"),
    next: requireElement("#status-next"),
    togglePlan: requireElement("#btn-toggle-plan"),
    demo: requireElement("#btn-demo"),
    windowError: requireElement("#window-error"),
    windowSummary: requireElement("#window-summary"),
    sundayAsWeekday: requireElement("#home-sunday-as-weekday"),
    whitelistSummary: requireElement("#whitelist-summary"),
    audioPresets: requireElement("#home-audio-presets"),
    audioDurations: requireElement("#home-audio-durations"),
    aiSummary: requireElement("#ai-summary"),
    brandSub: requireElement("#brand-sub"),
  };

  // ── 时段编辑器 ──
  const windowEditor = createWindowEditor({
    container: requireElement("#home-windows"),
    getValue: () => settingsStore.value.plan.windows,
    onChange: (dayType, patch) => actions.setWindow(dayType, patch),
    onError: (problems) => {
      if (problems.length) {
        setText(els.windowError, problems.join("；"));
        setHidden(els.windowError, false);
      } else {
        setHidden(els.windowError, true);
      }
    },
  });

  // ── 提前提醒时长 ──
  const warnChips = createChipGroup({
    container: requireElement("#home-warn"),
    options: WARN_MINUTE_OPTIONS.map((minutes) => ({ value: minutes, label: `提前 ${minutes} 分钟` })),
    getValue: () => settingsStore.value.plan.warnMinutes,
    onSelect: (minutes) => actions.setWarnMinutes(Number(minutes)),
  });

  // ── 助眠音频预设 ──
  function rebuildAudioPresets() {
    replaceChildren(
      els.audioPresets,
      AUDIO_PRESETS.map((preset) =>
        el(
          "button",
          {
            type: "button",
            class: "chip",
            dataset: { preset: preset.id },
            onClick: () => actions.setAudioPreset(preset.id),
          },
          [preset.name],
        ),
      ),
    );
  }
  rebuildAudioPresets();

  const audioDurationChips = createChipGroup({
    container: requireElement("#home-audio-durations"),
    options: core.AUDIO_DURATION_OPTIONS.map((option) => ({ value: option.minutes, label: option.label })),
    getValue: () => settingsStore.value.audio.durationMinutes,
    onSelect: (minutes) => actions.setAudioDuration(Number(minutes)),
  });

  // ── 事件绑定 ──
  els.togglePlan.addEventListener("click", () => actions.setPlanEnabled(!settingsStore.value.plan.enabled));
  els.demo.addEventListener("click", () => actions.startDemo());
  els.sundayAsWeekday.addEventListener("change", () => actions.setSundayAsWeekday(els.sundayAsWeekday.checked));
  requireElement("#btn-manage-whitelist").addEventListener("click", () => actions.openSheet("whitelist"));
  requireElement("#btn-ai-config").addEventListener("click", () => actions.openSheet("ai"));
  requireElement("#btn-sources").addEventListener("click", () => actions.openSheet("sources"));
  requireElement("#btn-profile").addEventListener("click", () => actions.goTo("profile"));

  const PHASE_LABELS = {
    off: "计划已关闭",
    idle: "计划已开启",
    warning: "即将进入熄灯",
    active: "熄灯中",
  };

  function update(snapshot, ui) {
    const settings = snapshot.settings;
    const phase = ui.effectivePhase(snapshot);

    // 状态灯
    els.dot.className = "status__dot";
    if (phase === "active") els.dot.classList.add("is-active");
    else if (phase === "warning") els.dot.classList.add("is-warn");
    else if (phase === "idle") els.dot.classList.add("is-on");

    setText(els.label, ui.isDemo() ? "演示模式进行中" : PHASE_LABELS[phase] ?? "—");

    // 主状态文案
    if (ui.isDemo()) {
      setText(els.detail, "正在体验熄灯界面");
      setText(els.next, `演示将在 ${Math.ceil(ui.demoRemainingMs() / 60_000)} 分钟后自动结束`);
    } else if (phase === "active") {
      setText(els.detail, core.formatDurationCN(snapshot.remainingMs));
      setText(els.next, "距离本次熄灯结束");
    } else if (snapshot.window) {
      const start = snapshot.window.start;
      setText(els.detail, core.formatDurationCN(snapshot.remainingMs));
      setText(
        els.next,
        `距离 ${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")} 熄灯`,
      );
    } else {
      setText(els.detail, "暂无生效时段");
      setText(els.next, "请检查睡眠时段设置");
    }

    toggleClass(els.togglePlan, "btn--primary", !settings.plan.enabled);
    setText(els.togglePlan, settings.plan.enabled ? "关闭计划" : "开启计划");
    setText(els.brandSub, snapshot.scene.sceneLabel);

    windowEditor.update();
    warnChips.update();
    els.sundayAsWeekday.checked = settings.plan.sundayAsWeekday !== false;

    // 时段摘要
    const windows = settings.plan.windows;
    setText(
      els.windowSummary,
      `工作日 ${describeWindow(windows[DAY_TYPE.WEEKDAY])}；周末 ${describeWindow(windows[DAY_TYPE.WEEKEND])}`,
    );

    // 白名单摘要
    const apps = settings.whitelist.apps;
    const customCount = apps.filter((app) => !app.system).length;
    setText(
      els.whitelistSummary,
      `共 ${settings.whitelist.totalMinutes} 分钟可用时长 · 已添加 ${customCount} 个自定义应用（电话、短信不受限）`,
    );

    // 音频预设高亮
    for (const button of els.audioPresets.children) {
      const selected = button.dataset.preset === settings.audio.preset;
      toggleClass(button, "is-selected", selected);
      toggleClass(button, "is-playing", selected && ctx.audio.isPlaying);
    }
    audioDurationChips.update();

    // AI 摘要
    const ai = settings.ai;
    if (!ai.enabled) setText(els.aiSummary, "未启用 · 正在使用内置文案库（功能完整）");
    else if (!ai.apiKey) setText(els.aiSummary, "已启用但未填写 API Key · 暂时仍使用内置文案库");
    else setText(els.aiSummary, `已启用 · ${ai.model} · 已缓存 ${ctx.ai.cacheSize()} 条文案`);
  }

  return { update };
}
