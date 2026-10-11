/**
 * 个人中心（PRD 2.1.3「个人中心可查看本周剩余解除次数」）。
 */

import { el, icon, replaceChildren, setHidden, setText } from "../lib/dom.js";
import { requireElement } from "./controls.js";

export function createProfileView(ctx) {
  const { core, actions } = ctx;

  const els = {
    quota: requireElement("#quota-display"),
    quotaHint: requireElement("#quota-hint"),
    budgetFill: requireElement("#budget-fill"),
    budgetHint: requireElement("#budget-hint"),
    password: requireElement("#profile-password"),
    passwordHint: requireElement("#password-hint"),
    savePassword: requireElement("#btn-save-password"),
    back: requireElement("#btn-profile-back"),
    resetAll: requireElement("#btn-reset-all"),
  };

  els.back.addEventListener("click", () => actions.goTo("home"));
  els.resetAll.addEventListener("click", () => actions.clearAllData());

  els.savePassword.addEventListener("click", async () => {
    const password = els.password.value;
    const advice = core.passwordAdvice(password);
    if (advice.length) {
      setText(els.passwordHint, advice.join("；"));
      els.passwordHint.classList.add("hint--error");
      return;
    }
    await actions.savePassword(password);
    els.password.value = "";
    setText(els.passwordHint, "已更新。请记牢，忘记后只能清除本地数据重置。");
    els.passwordHint.classList.remove("hint--error");
  });

  function update(snapshot, ui) {
    // 本周额度
    const quota = snapshot.quota;
    replaceChildren(
      els.quota,
      Array.from({ length: quota.total }, (unused, index) => {
        const filled = index < quota.remaining;
        const pip = el("span", { class: `quota__pip${filled ? " is-filled" : ""}` });
        if (filled) pip.append(icon("i-check"));
        return pip;
      }),
    );
    setText(
      els.quotaHint,
      quota.total === 0
        ? "本周额度已关闭。"
        : `本周还剩 ${quota.remaining} / ${quota.total} 次。每周一 0 点自动重置。`,
    );

    // 白名单今日用量
    const budget = ctx.budget.snapshot(snapshot.at);
    const ratio = budget.totalMs > 0 ? (budget.usedMs / budget.totalMs) * 100 : 0;
    els.budgetFill.style.width = `${Math.min(100, ratio).toFixed(1)}%`;
    setText(
      els.budgetHint,
      budget.totalMs === 0
        ? "未设置可用时长。"
        : `已用 ${core.formatDurationCN(budget.usedMs)} / 共 ${core.formatDurationCN(budget.totalMs)}` +
          (budget.exhausted ? " · 今日已用尽" : ""),
    );

    setHidden(els.savePassword, false);
  }

  return { update };
}
