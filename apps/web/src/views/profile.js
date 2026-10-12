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
    weekReview: requireElement("#week-review"),
    weekReviewSummary: requireElement("#week-review-summary"),
    password: requireElement("#profile-password"),
    passwordHint: requireElement("#password-hint"),
    savePassword: requireElement("#btn-save-password"),
    forgotPassword: requireElement("#btn-forgot-password"),
    passwordResetHint: requireElement("#password-reset-hint"),
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

  els.forgotPassword.addEventListener("click", () => {
    const info = actions.requestPasswordReset();
    if (info?.pending) {
      setText(els.passwordResetHint, `重置申请已生效：约 ${Math.ceil(info.remainingMs / 3_600_000)} 小时后密码与本周额度将被重置。期间无法紧急解除。`);
    }
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

    // 本周坚持回顾（自然周周一起 7 天）
    const days = ctx.sleepRecords.week(snapshot.at, {
      whitelistMsFor: (day) => ctx.budget.snapshot(day).usedMs,
    });
    replaceChildren(
      els.weekReview,
      days.map((day) => {
        const isToday = day.dateKey === core.dateKey(snapshot.at);
        const stateClass = !day.entered
          ? "is-missed"
          : day.dismissed
            ? "is-dismissed"
            : "is-kept";
        const cell = el("div", {
          class: `week-grid__cell ${stateClass}${isToday ? " is-today" : ""}`,
          title:
            day.dateKey +
            (day.entered ? " 进入熄灯" : " 未进入熄灯") +
            (day.dismissed ? ` · 解除 ${day.dismissCount} 次` : "") +
            (day.whitelistMs > 0 ? ` · 白名单 ${core.formatDurationCN(day.whitelistMs)}` : ""),
        });
        const label = el("span", { class: "week-grid__label", text: day.weekdayLabel });
        const stateText = !day.entered ? "—" : day.dismissed ? "醒" : "✓";
        const mark = el("span", { class: "week-grid__mark", text: stateText });
        cell.append(mark, label);
        return cell;
      }),
    );
    const keptDays = days.filter((day) => day.entered && !day.dismissed).length;
    const totalDismiss = days.reduce((sum, day) => sum + day.dismissCount, 0);
    setText(
      els.weekReviewSummary,
      `本周 ${keptDays} 天按时熄灯 · 解除 ${totalDismiss} 次` +
        (totalDismiss === 0 && keptDays > 0 ? " · 完美的一周，继续保持" : ""),
    );

    setHidden(els.savePassword, false);

    // 忘记密码重置状态（24 小时冷却）
    const reset = snapshot.passwordReset ?? { pending: false, remainingMs: 0 };
    if (reset.pending) {
      const hours = Math.ceil(reset.remainingMs / 3_600_000);
      setText(
        els.passwordResetHint,
        `重置冷却中：约 ${hours} 小时后密码与本周额度将被重置，期间无法紧急解除。`,
      );
      els.passwordResetHint.classList.add("hint--warn");
    } else {
      setText(els.passwordResetHint, "");
      els.passwordResetHint.classList.remove("hint--warn");
    }
  }

  return { update };
}
