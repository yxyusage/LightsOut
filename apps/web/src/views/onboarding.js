/**
 * 首次使用引导。
 *
 * 三个步骤：说明能力边界 → 设置睡眠时段 → 设置紧急解除密码。
 * 第 1 步刻意把"浏览器做不到什么"讲清楚，这是产品诚信的一部分，
 * 这比夸大能力更能建立信任 —— 而信任是强制型工具唯一能长期生效的基础。
 */

import { DAY_TYPE, WARN_MINUTE_OPTIONS } from "../core.js";
import { el, replaceChildren, setHidden, setText } from "../lib/dom.js";
import { createChipGroup, createWindowEditor, requireElement } from "./controls.js";

export function createOnboardingView(ctx) {
  const { core, settingsStore, actions } = ctx;

  const root = requireElement("#screen-onboarding");
  const steps = new Map(
    Array.from(root.querySelectorAll("[data-step]")).map((node) => [node.dataset.step, node]),
  );

  const passwordInput = requireElement("#onboard-password");
  const passwordError = requireElement("#onboard-password-error");

  const windowEditor = createWindowEditor({
    container: requireElement("#onboard-windows"),
    getValue: () => settingsStore.value.plan.windows,
    onChange: (dayType, patch) => actions.setWindow(dayType, patch),
  });

  const warnChips = createChipGroup({
    container: requireElement("#onboard-warn"),
    options: WARN_MINUTE_OPTIONS.map((minutes) => ({ value: minutes, label: `提前 ${minutes} 分钟` })),
    getValue: () => settingsStore.value.plan.warnMinutes,
    onSelect: (minutes) => actions.setWarnMinutes(Number(minutes)),
  });

  function goToStep(step) {
    for (const [key, node] of steps) setHidden(node, key !== String(step));
    if (String(step) === "2") windowEditor.update();
    if (String(step) === "2") warnChips.update();
    if (String(step) === "3") passwordInput.focus();
  }

  for (const button of root.querySelectorAll("[data-next]")) {
    button.addEventListener("click", () => goToStep(button.dataset.next));
  }

  requireElement("#onboard-finish").addEventListener("click", async () => {
    const password = passwordInput.value;
    const advice = core.passwordAdvice(password);
    if (advice.length) {
      setText(passwordError, advice.join("；"));
      setHidden(passwordError, false);
      return;
    }
    setHidden(passwordError, true);
    await actions.finishOnboarding(password);
  });

  passwordInput.addEventListener("input", () => setHidden(passwordError, true));

  return {
    root,
    show() {
      goToStep(1);
    },
    update() {
      windowEditor.update();
      warnChips.update();
    },
  };
}
