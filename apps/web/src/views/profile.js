/**
 * 个人中心（PRD 2.1.3「个人中心可查看本周剩余解除次数」）。
 */

import { el, icon, replaceChildren, setHidden, setText } from "../lib/dom.js";
import { renderShareCard, shareCard } from "../lib/share-card.js";
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
    shareWeek: requireElement("#btn-share-week"),
    shareWeekHint: requireElement("#share-week-hint"),
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

  // 生成本周卡片并分享。
  // 卡片完全由本机 canvas 绘制、不发任何请求 —— 这与"数据不出本机"的承诺一致，
  // 所以这里不需要（也不应该有）任何上传或第三方分享 SDK。
  els.shareWeek.addEventListener("click", async () => {
    setText(els.shareWeekHint, "正在生成…");
    try {
      const now = new Date();
      const days = ctx.sleepRecords.week(now);
      const keptDays = days.filter((day) => day.entered && !day.dismissed).length;
      const totalDismiss = days.reduce((sum, day) => sum + day.dismissCount, 0);
      const rangeLabel = days.length
        ? `${days[0].dateKey} — ${days[days.length - 1].dateKey}`
        : "";

      const canvas = renderShareCard({ days, keptDays, totalDismiss, rangeLabel });
      const result = await shareCard(canvas, {
        text: `我本周按时熄灯 ${keptDays} 天。熄灯早睡 —— 到点把手机交还给睡眠。`,
      });

      const messages = {
        shared: "已调起系统分享面板，选微信或 QQ 即可发出去",
        downloaded: "卡片已存到下载目录，可以自己发出去",
        cancelled: "已取消分享",
        unsupported: "当前浏览器不能生成图片，请换用手机浏览器打开",
      };
      setText(els.shareWeekHint, messages[result] ?? "");
    } catch (error) {
      setText(els.shareWeekHint, "生成失败：" + (error?.message ?? "未知错误"));
    }
  });

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
    setText(els.passwordHint, "已更新。请记牢；实测确实忘了，可以用下面的「忘记密码」在 24 小时后重置。");
    els.passwordHint.classList.remove("hint--error");
  });

  els.forgotPassword.addEventListener("click", () => {
    const info = actions.requestPasswordReset();
    if (info?.pending) {
      setText(
        els.passwordResetHint,
        `重置申请已生效：约 ${Math.ceil(info.remainingMs / 3_600_000)} 小时后密码会被清空，届时可设置新密码。` +
          "本周额度不受影响；这期间用正确密码依然可以正常解除。"
      );
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
    // 空状态：新用户看到"本周 0 天按时熄灯 · 解除 0 次"是很挫败的，
    // 而且读起来像"统计失败"。换成一句有方向感的引导。
    setText(
      els.weekReviewSummary,
      keptDays === 0 && totalDismiss === 0
        ? "本周还没有记录。今晚按时熄灯，这里就会亮起第一天。"
        : `本周 ${keptDays} 天按时熄灯 · 解除 ${totalDismiss} 次` +
            (totalDismiss === 0 && keptDays > 0 ? " · 完美的一周，继续保持" : ""),
    );

    setHidden(els.savePassword, false);

    // 忘记密码重置状态（24 小时冷却）
    const reset = snapshot.passwordReset ?? { pending: false, remainingMs: 0 };
    if (reset.pending) {
      const hours = Math.ceil(reset.remainingMs / 3_600_000);
      setText(
        els.passwordResetHint,
        `重置冷却中：约 ${hours} 小时后密码会被清空（本周额度不变）。这期间用正确密码仍可正常解除。`,
      );
      els.passwordResetHint.classList.add("hint--warn");
    } else {
      setText(els.passwordResetHint, "");
      els.passwordResetHint.classList.remove("hint--warn");
    }
  }

  return { update };
}
