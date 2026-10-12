/**
 * 「本周坚持」分享卡片。
 *
 * 纯 canvas 绘制，零依赖、零上传 —— 卡片完全在本机生成，
 * 与"所有数据只写入本机 localStorage，不上传任何服务器"的承诺一致。
 *
 * 分享策略（按可用性降级）：
 *  1. navigator.share({ files }) —— Android Chrome 上会唤起系统分享面板，
 *     微信 / QQ 都在候选里，这是手机上最自然的路径；
 *  2. 不支持文件分享时，退化成"下载图片 + 复制文案"，用户自己发出去；
 *  3. 连下载都不行（极老的浏览器）就给一句提示，不假装成功。
 */

const WEEKDAY_CN = ["日", "一", "二", "三", "四", "五", "六"];

const CARD_W = 1080;
const CARD_H = 1440;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 把一周记录画成卡片。返回 canvas，方便测试与预览。 */
export function renderShareCard({ days, keptDays, totalDismiss, rangeLabel }) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
  const lamp = "#ffd7a0";
  const lampSoft = "#ffbe6a";
  const dim = "#8a8a8a";

  // 背景：接近应用黑屏的纯黑，带一点自左上角的暖光
  ctx.fillStyle = "#08080a";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const glow = ctx.createRadialGradient(CARD_W * 0.32, CARD_H * 0.3, 0, CARD_W * 0.32, CARD_H * 0.3, CARD_W * 0.95);
  glow.addColorStop(0, "rgba(255,190,106,0.16)");
  glow.addColorStop(1, "rgba(255,190,106,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // 品牌
  ctx.fillStyle = lamp;
  ctx.font = `500 46px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("熄灯早睡", 96, 150);
  ctx.fillStyle = dim;
  ctx.font = `400 30px ${FONT}`;
  ctx.fillText("到点熄灯，把手机交还给睡眠", 96, 202);

  // 主数字
  ctx.fillStyle = "#f2f2f2";
  ctx.font = `300 190px ${FONT}`;
  ctx.fillText(String(keptDays), 90, 470);
  const numberWidth = ctx.measureText(String(keptDays)).width;
  ctx.fillStyle = lamp;
  ctx.font = `400 56px ${FONT}`;
  ctx.fillText("天", 90 + numberWidth + 26, 470);
  ctx.fillStyle = dim;
  ctx.font = `400 34px ${FONT}`;
  ctx.fillText("本周按时熄灯", 96, 528);
  ctx.fillText(rangeLabel ?? "", 96, 578);

  // 七天点阵
  // 单元格宽度必须按"卡片可用宽度"反算，否则第 7 格会被右边缘裁掉。
  // 可用宽度 = 卡宽 − 左右各 96 的外边距；7 格之间有 6 个间隙。
  const cellGap = 18;
  const gridX = 96;
  const cellW = Math.floor((CARD_W - gridX * 2 - cellGap * 6) / 7);
  const gridY = 680;
  days.forEach((day, index) => {
    const x = gridX + index * (cellW + cellGap);
    const kept = day.entered && !day.dismissed;
    const dismissed = Boolean(day.dismissed);

    ctx.fillStyle = "rgba(255,255,255,0.03)";
    roundRect(ctx, x, gridY, cellW, 176, 26);
    ctx.fill();
    ctx.strokeStyle = kept ? "rgba(126,217,159,0.55)" : dismissed ? "rgba(255,170,120,0.55)" : "rgba(255,255,255,0.10)";
    ctx.lineWidth = 3;
    roundRect(ctx, x, gridY, cellW, 176, 26);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.fillStyle = kept ? "#7ED99F" : dismissed ? "#FFAA78" : "#5f5f5f";
    ctx.font = `500 54px ${FONT}`;
    ctx.fillText(kept ? "✓" : dismissed ? "解" : "·", x + cellW / 2, gridY + 86);

    ctx.fillStyle = dim;
    ctx.font = `400 30px ${FONT}`;
    ctx.fillText(WEEKDAY_CN[day.weekday], x + cellW / 2, gridY + 142);
  });
  ctx.textAlign = "left";

  // 副信息
  ctx.fillStyle = "#b9b9b9";
  ctx.font = `400 36px ${FONT}`;
  const dismissLine =
    totalDismiss === 0
      ? "本周一次紧急解除都没用 —— 完美的一周"
      : `本周紧急解除 ${totalDismiss} 次`;
  ctx.fillText(dismissLine, 96, 990);

  // 分隔线 + 页脚
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(96, 1080);
  ctx.lineTo(CARD_W - 96, 1080);
  ctx.stroke();

  ctx.fillStyle = "#6a6a6a";
  ctx.font = `400 28px ${FONT}`;
  ctx.fillText("所有数据只写入本机，不上传任何服务器", 96, 1148);
  ctx.fillText("开源 · 零依赖 · 数据不出本机", 96, 1196);

  // 右下角：拉绳灯泡标记
  const bulbX = CARD_W - 176;
  const bulbY = CARD_H - 196;
  ctx.strokeStyle = lampSoft;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(bulbX, bulbY, 62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(bulbX, bulbY - 190);
  ctx.lineTo(bulbX, bulbY - 96);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(bulbX, bulbY - 80, 20, 0, Math.PI * 2);
  ctx.stroke();

  return canvas;
}

/**
 * 分享或下载卡片。
 * @returns {Promise<'shared' | 'downloaded' | 'cancelled' | 'unsupported'>}
 */
export async function shareCard(canvas, { filename = "熄灯早睡-本周坚持.png", text } = {}) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return "unsupported";

  const file = new File([blob], filename, { type: "image/png" });
  const canShareFiles =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] });

  if (canShareFiles) {
    try {
      await navigator.share({ files: [file], text });
      return "shared";
    } catch (error) {
      // 用户主动取消不算失败
      if (error && error.name === "AbortError") return "cancelled";
      // 其它错误继续走下载降级
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 交给浏览器读完再回收
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "downloaded";
}
