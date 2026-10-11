#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
熄灯早睡 · 图标与赛事封面生成脚本

产物（全部写入 apps/web/assets/）：
  icon-192.png            应用图标
  icon-512.png            应用图标（高分屏 / PWA）
  icon-maskable-512.png   Android 自适应图标（内容内缩到安全区）
  apple-touch-icon.png    iOS 主屏图标
  favicon.png             浏览器标签页图标
  cover-16x9.png          赛事封面（1920x1080，16:9）

设计依据 PRD 4.2：核心元素为带拉绳的灯泡，简约线性风格，深色背景。
所有图形都用 Pillow 直接绘制，不依赖外部素材，因此不存在第三方版权问题
（赛事要求参赛素材必须享有合法权利）。

用法：python scripts/make-assets.py
"""

import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "apps", "web", "assets")

FONT_REGULAR = "C:/Windows/Fonts/msyh.ttc"
FONT_LIGHT = "C:/Windows/Fonts/msyhl.ttc"
FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"

# 与 styles/app.css 中的设计令牌保持一致
LAMP = (255, 215, 160)
LAMP_SOFT = (255, 190, 106)
CORD = (120, 95, 60)
TEXT = (219, 219, 224)
TEXT_DIM = (128, 128, 138)
TEXT_FAINT = (86, 86, 96)

SUPERSAMPLE = 4


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.truetype(FONT_REGULAR, size)


def radial_glow(size, center, radius, color, max_alpha=120, power=2.2):
    """用 numpy 生成径向渐变光晕，比逐像素循环快两个数量级。

    `size` 可以是单个整数（正方形）或 (宽, 高) 元组（矩形画布需要）。
    """
    if isinstance(size, (tuple, list)):
        width, height = int(size[0]), int(size[1])
    else:
        width = height = int(size)
    yy, xx = np.mgrid[0:height, 0:width]
    distance = np.hypot(xx - center[0], yy - center[1]) / max(radius, 1e-6)
    alpha = np.clip(1.0 - distance, 0.0, 1.0) ** power * max_alpha
    layer = np.zeros((height, width, 4), dtype=np.uint8)
    layer[..., 0] = color[0]
    layer[..., 1] = color[1]
    layer[..., 2] = color[2]
    layer[..., 3] = alpha.astype(np.uint8)
    return Image.fromarray(layer, "RGBA")


def render_lamp(size, inset=0.0, transparent=False):
    """绘制"带拉绳的灯泡"。inset 为内容内缩比例（maskable 图标需要）。"""
    big = size * SUPERSAMPLE
    background = (0, 0, 0, 0) if transparent else (0, 0, 0, 255)
    canvas = Image.new("RGBA", (big, big), background)

    scale = 1.0 - inset
    center_x = big / 2.0

    # 光晕放在最底层。刻意做得克制：一旦填满灯泡内部，就会变成"实心亮球"，
    # 违背 PRD 4.2 要求的"简约线性风格"。这里只让光晕浮在轮廓之外。
    canvas = Image.alpha_composite(
        canvas,
        radial_glow(big, (center_x, big * 0.655), big * 0.30 * scale, (255, 196, 118), max_alpha=62, power=2.7),
    )
    draw = ImageDraw.Draw(canvas)

    stroke = max(2, int(big * 0.0155 * scale))
    thin = max(2, int(big * 0.012 * scale))

    # 灯绳
    draw.line([(center_x, big * 0.05), (center_x, big * 0.355 * scale)], fill=CORD + (255,), width=thin)

    # 拉环（灯绳末端的圆环）
    ring_r = big * 0.043 * scale
    ring_y = big * 0.393 * scale
    draw.ellipse(
        [center_x - ring_r, ring_y - ring_r, center_x + ring_r, ring_y + ring_r],
        outline=LAMP_SOFT + (255,),
        width=thin,
    )

    # 灯座
    base_w = big * 0.128 * scale
    base_h = big * 0.046 * scale
    base_top = big * 0.443 * scale
    draw.rounded_rectangle(
        [center_x - base_w / 2, base_top, center_x + base_w / 2, base_top + base_h],
        radius=int(big * 0.014 * scale),
        outline=LAMP_SOFT + (255,),
        width=stroke,
    )

    # 灯颈：把灯座与灯泡连起来，避免两者之间出现视觉断裂
    neck_w = big * 0.052 * scale
    draw.rectangle(
        [center_x - neck_w / 2, base_top + base_h - stroke, center_x + neck_w / 2, big * 0.522 * scale],
        outline=LAMP_SOFT + (255,),
        width=stroke,
    )

    # 灯泡：纯轮廓，内部留空 —— 这才是"线性风格"
    bulb_r = big * 0.150 * scale
    bulb_y = big * 0.668 * scale
    draw.ellipse(
        [center_x - bulb_r, bulb_y - bulb_r, center_x + bulb_r, bulb_y + bulb_r],
        outline=LAMP + (255,),
        width=stroke,
    )

    return canvas.resize((size, size), Image.LANCZOS)


def text_width(font_obj, text, tracking=0.0):
    if not text:
        return 0.0
    return sum(font_obj.getlength(ch) for ch in text) + tracking * (len(text) - 1)


def draw_tracked(draw, xy, text, font_obj, fill, tracking=0.0):
    """Pillow 不支持字间距，这里逐字绘制来实现"字重偏轻、留白舒展"的排版。"""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font_obj, fill=fill)
        x += font_obj.getlength(ch) + tracking
    return x


def render_cover(width=1920, height=1080):
    """赛事封面：左侧品牌与卖点，右侧熄灯界面示意。"""
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 255))

    # 背景：左上角一盏灯的余光
    canvas = Image.alpha_composite(
        canvas,
        radial_glow((width, height), (width * 0.30, height * 0.34), width * 0.42, (255, 190, 110), max_alpha=42, power=1.8),
    )
    canvas = Image.alpha_composite(
        canvas,
        radial_glow((width, height), (width * 0.79, height * 0.52), width * 0.30, (255, 205, 140), max_alpha=30, power=1.7),
    )
    draw = ImageDraw.Draw(canvas)

    # ── 左侧：图标 + 标题 ──
    mark_size = 190
    mark = render_lamp(mark_size, transparent=True)
    canvas.alpha_composite(mark, (int(width * 0.075), int(height * 0.13)))
    draw = ImageDraw.Draw(canvas)

    title_font = font(FONT_LIGHT, 104)
    title_x = width * 0.075
    title_y = height * 0.375
    draw_tracked(draw, (title_x, title_y), "熄灯早睡", title_font, TEXT, tracking=10)

    sub_font = font(FONT_LIGHT, 36)
    draw_tracked(draw, (title_x + 4, title_y + 132), "到点熄灯，把手机交还给睡眠", sub_font, LAMP_SOFT, tracking=4)

    # 分隔线
    draw.line([(title_x + 4, height * 0.615), (title_x + 92, height * 0.615)], fill=(255, 190, 106, 150), width=3)

    # 卖点
    bullet_font = font(FONT_LIGHT, 33)
    bullets = [
        "到点全屏接管，改时间 / 切走 / 刷新都甩不掉",
        "五类助眠白噪音，Web Audio 实时合成，零音频素材",
        "AI 识别周五晚与法定节假日，生成一句当下的话",
        "每周 2 次紧急解除额度，周一 0 点自动重置",
    ]
    bullet_y = height * 0.665
    for line in bullets:
        draw.ellipse([title_x + 4, bullet_y + 14, title_x + 14, bullet_y + 24], fill=LAMP_SOFT + (220,))
        draw_tracked(draw, (title_x + 34, bullet_y), line, bullet_font, TEXT_DIM, tracking=1)
        bullet_y += 54

    # 角标
    badge_font = font(FONT_REGULAR, 25)
    badge_text = "支付宝「智能体涌现奖」参赛作品 · 生活好帮手"
    badge_w = text_width(badge_font, badge_text, 1) + 52
    badge_y = height - 122
    draw.rounded_rectangle(
        [title_x, badge_y, title_x + badge_w, badge_y + 52],
        radius=26,
        fill=(255, 190, 106, 16),
        outline=(255, 190, 106, 90),
        width=2,
    )
    draw_tracked(draw, (title_x + 26, badge_y + 12), badge_text, badge_font, LAMP_SOFT, tracking=1)

    # ── 右侧：手机与熄灯界面示意 ──
    phone_w, phone_h = 430, 838
    phone_x = int(width * 0.745)
    phone_y = int((height - phone_h) / 2)
    draw.rounded_rectangle(
        [phone_x, phone_y, phone_x + phone_w, phone_y + phone_h],
        radius=54,
        fill=(9, 9, 12, 255),
        outline=(48, 48, 56, 255),
        width=3,
    )
    draw.rounded_rectangle(
        [phone_x + 16, phone_y + 16, phone_x + phone_w - 16, phone_y + phone_h - 16],
        radius=42,
        outline=(28, 28, 34, 255),
        width=2,
    )

    draw = ImageDraw.Draw(canvas)
    inner_cx = phone_x + phone_w / 2

    # 时间
    clock_font = font(FONT_LIGHT, 106)
    clock = "23:47"
    clock_w = text_width(clock_font, clock, 3)
    draw_tracked(draw, (inner_cx - clock_w / 2, phone_y + 150), clock, clock_font, (232, 232, 236), tracking=3)

    small_font = font(FONT_LIGHT, 25)
    line2 = "距离本次熄灯结束还有 7 小时 13 分"
    w2 = text_width(small_font, line2, 1)
    draw_tracked(draw, (inner_cx - w2 / 2, phone_y + 288), line2, small_font, (126, 126, 136), tracking=1)

    scene_font = font(FONT_LIGHT, 23)
    scene = "周五晚 · 2026-09-04"
    ws = text_width(scene_font, scene, 3)
    draw_tracked(draw, (inner_cx - ws / 2, phone_y + 330), scene, scene_font, (74, 74, 84), tracking=3)

    # 文案
    copy_font = font(FONT_LIGHT, 32)
    copy_lines = ["明天就是周末了，今晚睡个好觉，", "周末好好放松。"]
    copy_y = phone_y + 452
    for line in copy_lines:
        lw = text_width(copy_font, line, 2)
        draw_tracked(draw, (inner_cx - lw / 2, copy_y), line, copy_font, (168, 168, 178), tracking=2)
        copy_y += 56

    # 底部两个入口
    btn_w, btn_h = 168, 104
    gap = 22
    total = btn_w * 2 + gap
    left = inner_cx - total / 2
    btn_y = phone_y + phone_h - 190
    for index, label in enumerate(["白名单应用", "助眠音乐"]):
        bx = left + index * (btn_w + gap)
        draw.rounded_rectangle(
            [bx, btn_y, bx + btn_w, btn_y + btn_h],
            radius=20,
            fill=(255, 255, 255, 6),
            outline=(255, 255, 255, 22),
            width=2,
        )
        # 图标圆点替代线稿图标，缩略图尺寸下更清晰
        draw.ellipse([bx + btn_w / 2 - 13, btn_y + 24, bx + btn_w / 2 + 13, btn_y + 50], outline=(122, 92, 51, 255), width=2)
        label_font = font(FONT_LIGHT, 24)
        lw = text_width(label_font, label, 1)
        draw_tracked(draw, (bx + (btn_w - lw) / 2, btn_y + 62), label, label_font, (126, 126, 136), tracking=1)

    return canvas.convert("RGB")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    targets = [
        ("icon-512.png", 512, 0.0, False),
        ("icon-192.png", 192, 0.0, False),
        ("icon-maskable-512.png", 512, 0.19, False),
        ("apple-touch-icon.png", 180, 0.0, False),
        ("favicon.png", 64, 0.0, False),
    ]
    for name, size, inset, transparent in targets:
        image = render_lamp(size, inset=inset, transparent=transparent)
        path = os.path.join(OUT_DIR, name)
        image.save(path, "PNG", optimize=True)
        print("  写入 %-24s %4dx%-4d %6.1f KB" % (name, size, size, os.path.getsize(path) / 1024))

    cover_path = os.path.join(OUT_DIR, "cover-16x9.png")
    cover = render_cover()
    cover.save(cover_path, "PNG", optimize=True)
    cover_bytes = os.path.getsize(cover_path)
    print("  写入 %-24s %4dx%-4d %6.2f MB" % ("cover-16x9.png", 1920, 1080, cover_bytes / 1024 / 1024))

    # 赛事要求封面不超过 5MB；超限时自动改用 JPEG
    if cover_bytes > 5 * 1024 * 1024:
        jpg_path = os.path.join(OUT_DIR, "cover-16x9.jpg")
        cover.save(jpg_path, "JPEG", quality=92, optimize=True, subsampling=0)
        print("  PNG 超过 5MB，额外输出 %s（%.2f MB）" % (os.path.basename(jpg_path), os.path.getsize(jpg_path) / 1024 / 1024))


if __name__ == "__main__":
    main()
