/**
 * 底部浮层：助眠音频、白名单、紧急解除、AI 配置、数据溯源。
 *
 * 所有浮层共用同一套开关与关闭逻辑，只有内容不同。
 */

import {
  AUDIO_PRESETS,
  FACT_SOURCES,
  HOLIDAY_TABLE_SOURCE,
  WHITELIST_TOTAL_MINUTES_MAX,
  WHITELIST_TOTAL_MINUTES_MIN,
} from "../core.js";
import { el, icon, replaceChildren, setHidden, setText, toast, toggleClass } from "../lib/dom.js";
import { createChipGroup, requireElement } from "./controls.js";

export function createSheets(ctx) {
  const { core, settingsStore, actions } = ctx;

  const registry = new Map();
  for (const node of document.querySelectorAll(".sheet")) {
    registry.set(node.id.replace(/^sheet-/, ""), node);
    // 点击遮罩或关闭按钮关闭
    node.addEventListener("click", (event) => {
      if (event.target.closest("[data-close]")) actions.closeSheet(node.id.replace(/^sheet-/, ""));
    });
  }

  /* ───────── 助眠音频 ───────── */
  const audioPresetGrid = requireElement("#audio-presets");
  const audioDurations = createChipGroup({
    container: requireElement("#audio-durations"),
    options: core.AUDIO_DURATION_OPTIONS.map((option) => ({ value: option.minutes, label: option.label })),
    getValue: () => settingsStore.value.audio.durationMinutes,
    onSelect: (minutes) => actions.setAudioDuration(Number(minutes)),
  });
  const volumeSlider = requireElement("#audio-volume");
  const volumeLabel = requireElement("#audio-volume-label");
  volumeSlider.addEventListener("input", () => actions.setAudioVolume(Number(volumeSlider.value) / 100));

  function rebuildAudioPresets() {
    replaceChildren(
      audioPresetGrid,
      AUDIO_PRESETS.map((preset) =>
        el(
          "button",
          {
            type: "button",
            class: "audio-preset",
            dataset: { preset: preset.id },
            onClick: () => actions.setAudioPreset(preset.id),
          },
          [el("span", { text: preset.name }), el("small", { text: preset.description })],
        ),
      ),
    );
  }
  rebuildAudioPresets();

  requireElement("#btn-audio-toggle").addEventListener("click", () => actions.toggleAudio());

  /* ───────── 白名单 ───────── */
  const totalSlider = requireElement("#whitelist-total");
  totalSlider.addEventListener("change", () => actions.setWhitelistTotal(Number(totalSlider.value)));
  totalSlider.addEventListener("input", () => setText(requireElement("#whitelist-total-label"), `${totalSlider.value} 分钟`));

  const appList = requireElement("#whitelist-apps");
  const addForm = requireElement("#add-app-form");
  const addName = requireElement("#add-app-name");
  const addUrl = requireElement("#add-app-url");
  const addError = requireElement("#add-app-error");

  addForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = addName.value.trim();
    if (!name) {
      setText(addError, "请填写应用名称");
      setHidden(addError, false);
      return;
    }
    const result = actions.addWhitelistApp({ name, url: addUrl.value.trim() });
    if (!result.ok) {
      setText(addError, result.reason);
      setHidden(addError, false);
      return;
    }
    setHidden(addError, true);
    addName.value = "";
    addUrl.value = "";
  });

  /* ───────── 紧急解除 ───────── */
  const emergencyForm = requireElement("#emergency-form");
  const emergencyPassword = requireElement("#emergency-password");
  const emergencyError = requireElement("#emergency-error");

  emergencyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await actions.submitEmergency(emergencyPassword.value);
    if (result.ok) {
      emergencyPassword.value = "";
      setHidden(emergencyError, true);
      actions.closeSheet("emergency");
    } else {
      setText(emergencyError, result.message);
      setHidden(emergencyError, false);
      emergencyPassword.select?.();
    }
  });

  /* ───────── AI 配置 ───────── */
  const aiInputs = {
    enabled: requireElement("#ai-enabled"),
    baseUrl: requireElement("#ai-baseurl"),
    model: requireElement("#ai-model"),
    apiKey: requireElement("#ai-apikey"),
    status: requireElement("#ai-status"),
  };
  requireElement("#btn-ai-save").addEventListener("click", () => actions.saveAISettings(readAIInputs()));
  requireElement("#btn-ai-test").addEventListener("click", async () => {
    await actions.saveAISettings(readAIInputs());
    setText(aiInputs.status, "正在测试…");
    const result = await actions.testAIConnection();
    setText(aiInputs.status, result.message);
    aiInputs.status.classList.toggle("hint--error", !result.ok);
  });

  function readAIInputs() {
    return {
      enabled: aiInputs.enabled.checked,
      baseUrl: aiInputs.baseUrl.value.trim(),
      model: aiInputs.model.value.trim(),
      apiKey: aiInputs.apiKey.value,
    };
  }

  function syncAIInputs() {
    const ai = settingsStore.value.ai;
    if (document.activeElement !== aiInputs.baseUrl) aiInputs.baseUrl.value = ai.baseUrl;
    if (document.activeElement !== aiInputs.model) aiInputs.model.value = ai.model;
    if (document.activeElement !== aiInputs.apiKey) aiInputs.apiKey.value = ai.apiKey;
    aiInputs.enabled.checked = ai.enabled;
    if (!aiInputs.status.textContent.trim()) {
      setText(
        aiInputs.status,
        ai.enabled && ai.apiKey ? `已启用，缓存了 ${ctx.ai.cacheSize()} 条文案` : "未启用时使用内置文案库，功能完全可用",
      );
    }
  }

  /* ───────── 数据溯源（只需构建一次）───────── */
  const sourceList = requireElement("#source-list");
  replaceChildren(
    sourceList,
    Object.entries(FACT_SOURCES).flatMap(([key, source]) => [
      el("dt", { text: source.label }),
      el("dd", {}, [
        el("p", { text: source.finding }),
        el("a", { href: source.url, target: "_blank", rel: "noopener noreferrer", text: source.url }),
      ]),
    ]),
  );
  setText(
    requireElement("#holiday-source"),
    `${HOLIDAY_TABLE_SOURCE.title}（${HOLIDAY_TABLE_SOURCE.documentNumber}，${HOLIDAY_TABLE_SOURCE.issuedAt} 发布）。` +
      `覆盖范围 ${HOLIDAY_TABLE_SOURCE.coverage}；数据缺失的年份按普通日期处理，不会生成错误的节日文案。`,
  );

  /* ───────── 每帧刷新（只更新打开的浮层）───────── */
  function update(snapshot) {
    if (!registry.get("audio").hidden) {
      const settings = settingsStore.value;
      for (const button of audioPresetGrid.children) {
        const selected = button.dataset.preset === settings.audio.preset;
        toggleClass(button, "is-selected", selected);
        toggleClass(button, "is-playing", selected && ctx.audio.isPlaying);
      }
      audioDurations.update();
      if (document.activeElement !== volumeSlider) volumeSlider.value = String(Math.round(settings.audio.volume * 100));
      setText(volumeLabel, `${Math.round(settings.audio.volume * 100)}%`);
      setText(
        requireElement("#audio-status"),
        ctx.audio.isPlaying
          ? `正在播放「${AUDIO_PRESETS.find((p) => p.id === ctx.audio.current)?.name ?? ""}」`
          : ctx.audio.supported
            ? "未播放"
            : "当前浏览器不支持 Web Audio，无法合成白噪音",
      );
      setText(
        requireElement("#btn-audio-toggle"),
        ctx.audio.isPlaying ? "停止播放" : "开始播放",
      );
    }

    if (!registry.get("whitelist").hidden) {
      const settings = settingsStore.value;
      const budget = ctx.budget.snapshot(snapshot.at);
      if (document.activeElement !== totalSlider) totalSlider.value = String(settings.whitelist.totalMinutes);
      setText(requireElement("#whitelist-total-label"), `${settings.whitelist.totalMinutes} 分钟`);

      const ratio = budget.totalMs > 0 ? (budget.usedMs / budget.totalMs) * 100 : 0;
      requireElement("#whitelist-meter").style.width = `${Math.min(100, ratio).toFixed(1)}%`;
      setText(
        requireElement("#whitelist-remaining"),
        budget.exhausted
          ? "今日可用时长已用尽，熄灯界面将无法再打开白名单应用。"
          : `剩余 ${core.formatDurationCN(budget.remainingMs)}（今日已用 ${core.formatDurationCN(budget.usedMs)}）`,
      );

      replaceChildren(
        appList,
        settings.whitelist.apps.map((app) =>
          el("li", {}, [
            el(
              "button",
              {
                type: "button",
                class: "app-list__open",
                onClick: () => actions.openWhitelistApp(app),
              },
              [
                el("span", { class: "app-list__name", text: app.name }),
                el("span", {
                  class: "app-list__meta",
                  text: app.countsAgainstQuota ? "占用时长" : "不占时长",
                }),
              ],
            ),
            app.removable
              ? el(
                  "button",
                  {
                    type: "button",
                    class: "app-list__remove",
                    title: "移除",
                    onClick: () => actions.removeWhitelistApp(app.id),
                  },
                  [icon("i-close")],
                )
              : el("span", { class: "app-list__meta", text: "系统" }),
          ]),
        ),
      );
    }

    if (!registry.get("emergency").hidden) {
      const remaining = snapshot.quota.remaining;
      setText(
        requireElement("#emergency-quota-hint"),
        remaining > 0
          ? `本周还剩 ${remaining} 次解除额度。解除后本次熄灯立即失效。`
          : "本周解除额度已用完，只能等熄灯时段自然结束。",
      );
      const submit = requireElement("#btn-emergency-submit");
      submit.disabled = remaining <= 0;
    }

    if (!registry.get("ai").hidden) syncAIInputs();
  }

  return {
    registry,
    open(id) {
      const node = registry.get(id);
      if (!node) return;
      node.hidden = false;
      if (id === "emergency") {
        const input = requireElement("#emergency-password");
        input.value = "";
        setHidden(requireElement("#emergency-error"), true);
        setTimeout(() => input.focus(), 120);
      }
      if (id === "whitelist") {
        const remaining = ctx.budget.remainingMs(new Date());
        if (remaining <= 0) toast("今日白名单时长已用尽", { type: "error" });
      }
    },
    close(id) {
      const node = registry.get(id);
      if (node) node.hidden = true;
    },
    closeAll() {
      for (const node of registry.values()) node.hidden = true;
    },
    get anyOpen() {
      return [...registry.values()].some((node) => !node.hidden);
    },
    update,
  };
}

export { WHITELIST_TOTAL_MINUTES_MAX, WHITELIST_TOTAL_MINUTES_MIN };
