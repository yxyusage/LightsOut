# AI 矢量视频制作手册（HyperFrames 实战版）

> 面向：任何要"用代码做一个视频"的 AI 智能体（Claude / GPT / Gemini / 本地模型均可）
> 来源：一次真实交付（BiliLearn-AI 宣传片：7 支短片 / 117 秒 / 1920×1080 / 30fps / 全片通过校验）
> 特点：**所有结论都是实测过的**，包含踩过的坑、症状、根因与修法。命令可直接复制。

---

## 0 先读这一页（如果只读一页）

**技术选型结论**：用 **HyperFrames**（HTML + CSS + SVG + GSAP → MP4，Apache 2.0，Node 22+ 与 ffmpeg 即可）。
它的渲染模型是"**无头 Chrome 逐帧 seek + ffmpeg 编码**"，因此视频是**确定性**的：同一份 HTML，永远渲出同一帧。

**五条最贵的教训**（每一条都是本次真实踩坑换来的）：

| # | 教训 | 不遵守的后果 |
|---|---|---|
| 1 | **开工前先做"能力探针"**：用 2 秒小合成验证你要用的特性是否可用 | 花 1 小时写完，渲染出来全是静态图 |
| 2 | **只用 GSAP 时间轴驱动动画，禁用 CSS keyframes** | CSS 动画不会被 seek，渲出的是墙钟随机状态 |
| 3 | **验收必须抽 MP4 的帧并做像素测量**，不能只看 `check` 通过 | `check`/`snapshot` 与 `render` 的渲染路径不同，能骗过眼睛 |
| 4 | **一个视频 = 一个工程**；共享资产各放一份 | lint 报 `multiple_root_compositions`，或资源 404 |
| 5 | **渲染器视口比画布矮 87px**（本机实测），底部会被裁 | 字幕被切、底部元素消失、出现横向色差接缝 |

---

## 1 环境准备

### 1.1 依赖清单

| 依赖 | 版本要求 | 本机实测 | 备注 |
|---|---|---|---|
| Node.js | ≥ 22 | v24.21.0 | 需要内置 `WebSocket`（写零依赖 CDP 脚本用） |
| ffmpeg / ffprobe | 任意近版 | 6.1.6 | 编码与抽帧 |
| Chrome / Chromium | 近版 | Google Chrome 154 | 用系统 Chrome，别让 puppeteer 再下一份 |
| hyperframes CLI | 0.8.141 | npm 本地安装即可 | `npm i hyperframes` |

### 1.2 沙箱环境（**最容易卡住的地方**）

在受限沙箱里（只有工作区可写、`~` 不可写），CLI 会因为写缓存直接崩：

```
Error: EPERM: operation not permitted, mkdir '/Users/you/.cache/hyperframes'
npm error EPERM ... '/Users/you/.npm/_cacache'
```

**解法：把 HOME 重定向进工程**，并用环境变量复用系统 Chrome。落地成一个 `env.sh`：

```bash
# env.sh —— 放在工程根目录，每条命令前 source 一次
export HF_HOME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export HOME="$HF_HOME_DIR/.home"                       # 所有 CLI 缓存落进工程内
export HYPERFRAMES_BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
export HYPERFRAMES_NO_TELEMETRY=1
export HYPERFRAMES_MEDIA_HOME="$HF_HOME_DIR/.media"
export HYPERFRAMES_FONT_CACHE_DIR="$HF_HOME_DIR/.cache/fonts"
mkdir -p "$HOME" "$HYPERFRAMES_MEDIA_HOME" "$HYPERFRAMES_FONT_CACHE_DIR"
HF_BIN="$HF_HOME_DIR/node_modules/.bin/hyperframes"
```

npm 安装时同样要绕开 `~/.npm`：

```bash
npm i hyperframes gsap --cache ./.npm-cache --no-audit --no-fund
```

> 环境变量全集可用这行扫出来：`grep -rho "HYPERFRAMES_[A-Z_]*" node_modules/hyperframes/dist | sort -u`

### 1.3 工程脚手架

```bash
mkdir -p my-video/{assets/vendor,tools,renders}
cd my-video
npm i hyperframes gsap --cache ./.npm-cache --no-audit --no-fund
cp <手册>/templates/env.sh .
cp <手册>/templates/kit.css assets/
cp <手册>/templates/kit.js  assets/
cp node_modules/gsap/dist/gsap.min.js assets/vendor/
printf '{"id":"my-video","name":"my-video"}\n' > meta.json
```

---

## 2 拿到"做个视频"需求后的开工决策树

```
需求进来
 ├─ 有现成产品/网站/界面要展示？ ──是─→ 先跑「真实界面采集」(§8)，把截图/录屏落成本地文件
 │                                    └ 版权提醒：第三方内容（播放器、他人视频帧）必须避开或打码
 ├─ 有旁白/字幕要求？ ──是─→ 先写「字幕脚本 + 口播节奏表」(§7)，时间轴以它为准
 ├─ 拿不准某个视觉特性能不能做？ ──→ 先写「能力探针」(§3)，2 秒片验证，再动手
 └─ 拆片：一个需求拆成 N 支 10–25 秒短片（比一支长片更好改、好审、好并行）
        └─ 每支 = 一个独立工程（§5），共用同一份 kit 与截图资产
```

**时长经验**：宣传/介绍类 10–25 秒一支最舒服；总长 60–120 秒；单支超过 30 秒就该拆。
**节奏经验**：每 1.5–2.5 秒必须有一次视觉变化；快切段转场间隔 ≥0.6s，舒缓段 ≥1.5s。

---

## 3 能力探针（**最高杠杆的一步，别跳过**）

### 3.1 为什么要做

HyperFrames 的动画能力有"白名单之外也合法"的部分（官方文档明确说 `clipPath`/`strokeDashoffset` 等可用），
但**只有渲染出来才知道你的环境到底行不行**。花 2 分钟做一支探针，能省掉几小时的返工。

### 3.2 真实案例：探针推翻了我的默认假设

我最初打算用 CSS `@keyframes` 做动画（写起来最顺）。探针合成里放了三组对照：

- **GSAP 驱动**：`strokeDashoffset` 描边、`clipPath` 揭示、`transform`、`opacity`
- **CSS keyframes**：同样的效果
- **对照组**：同填充色但不加 `backdrop-filter` 的玻璃面板

渲染 2 秒后逐帧看结果：

| 测试 | 结果 |
|---|---|
| GSAP `strokeDashoffset` 描边 | ✅ 逐帧精确 |
| GSAP `clipPath` 揭示 | ✅ 逐帧精确 |
| GSAP transform / opacity | ✅ |
| **CSS keyframes** | ❌ 墙钟播放，不可 seek（渲染器自己打日志 `static-frame dedup: disabled (running CSS/WAAPI animation)`） |
| `backdrop-filter` 玻璃 | ✅ 真模糊（对照组后面锐利 → 证明不是假糊） |
| `mask-composite` 镜面描边 | ✅ |
| `feTurbulence` + `feDisplacementMap` 液态折射 | ✅ |
| `corner-shape: squircle` | ✅（Chrome 154 支持真超椭圆） |

**结论直接改变了架构**：全片只用一条 GSAP 时间轴。

### 3.3 探针合成模板

见 `templates/探针合成.html`。写探针的三条原则：

1. **每个特性一块独立区域**，标上编号与名称（渲染后一眼能对号）
2. **必须有对照组**（想要模糊就放一个不模糊的同款；想验证 seek 就放一个墙钟动画）
3. **让关键量随时间单调变化**（如 dashoffset 从满到 0），这样看几帧就能判断是否真的在动

---

## 4 HyperFrames 合成契约（硬规则）

### 4.1 最小可用合成

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1920, height=1080">
<style>
  html,body{width:1920px;height:1080px;overflow:hidden;margin:0}
  #root{position:relative;width:100%;height:100%}
  .clip{position:absolute;left:0;top:0;width:100%;height:100%}
</style>
</head>
<body>
<div id="root" data-composition-id="v01" data-start="0" data-duration="16.6"
     data-width="1920" data-height="1080" data-fps="30">
  <div id="scene" class="clip" data-start="0" data-duration="16.6">
    <!-- 画面内容 -->
  </div>
</div>
<script src="assets/vendor/gsap.min.js"></script>
<script>
(function(){
  "use strict";
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });      // 必须 paused
  tl.fromTo("#title", { opacity:0, y:30 }, { opacity:1, y:0, duration:.8, ease:"expo.out" }, 0.5);
  tl.to("#scene", { opacity:0, duration:.5, ease:"power2.in" }, 16.0);   // 收尾
  window.__timelines["v01"] = tl;                  // key 必须等于 data-composition-id
  tl.seek(0);                                      // 回到 0 帧，保证冷启动状态正确
})();
</script>
</body>
</html>
```

### 4.2 必须记住的语义（**单位与边界最容易搞错**）

| 项 | 规则 |
|---|---|
| `data-start` / `data-duration` | **秒**，不是帧 |
| 可见窗口 | **半开区间** `[start, start+duration)`，`t = start+duration` 那帧已不可见 → **退场动画要落在片长之前** |
| `data-width/height` | 画布像素。**别在 `#root` 上硬写 1920px**，运行时会把这两个值注入根节点 |
| `class="clip"` | 让元素得到满帧盒子的约定类；lint 缺了会警告 |
| `data-track-index` | 只影响 Studio 时间轴展示，**渲染不读**，也不决定层级（层级用 CSS `z-index` 或 DOM 顺序） |
| `data-duration` | 渲染长度 = 它的值，不是 GSAP 时间轴长度 |
| `window.__timelines[<id>]` | 每个合成注册**恰好一条** paused 时间轴，key = `data-composition-id` |

### 4.3 确定性红线（违反会渲出不可复现的帧）

**禁止**：`Date.now()` / `performance.now()` / 未播种 `Math.random()` / 渲染时联网取资源 / 依赖 hover 或滚动状态 / 无界 `repeat: -1`（除非根节点声明了有限 `data-duration`）。

**要用**：固定 seed 的 `feTurbulence`、构建期算好的常量、`BL.samplePath` 预采样路径点。

---

## 5 工程结构：一片一工程

```
my-video/                        # ← 交付包根目录
├── index.html                   # 片头/主合成（唯一位于根目录的合成）
├── 01-xxx/                      # 每支短片一个独立工程
│   ├── index.html
│   ├── hyperframes.json
│   ├── meta.json
│   └── assets/                  # kit + 截图（各自一份副本）
├── 02-yyy/
├── assets/                      # 共享源：kit.css / kit.js / cues.json / rects.json
│   ├── ui/                      # 工程内用的压缩截图（JPEG）
│   └── ui-master/               # 截图母版（PNG，可重裁）
├── tools/                       # 采集/渲染/字幕/装配脚本
└── renders/                     # 交付物：MP4 + SRT + 总表 + 总览
```

**为什么一片一工程**：

- lint 会报 `multiple_root_compositions`（根目录多个带 `data-composition-id` 的 HTML → 运行时可能重复播放音频）
- 放在**子目录**里就不会触发这条，且 lint 仍会逐个校验它们
- 每支可独立 `check` / `render` / 交付，改一支不影响其他

**资产路径坑**：子目录合成里写 `../assets/x.js` 会被 lint 判 `invalid_parent_traversal_in_asset_path`（Studio 预览会 404）。
→ **每个工程内放一份自己的 `assets/`**，合成里统一写 `assets/...`。这就是上面目录结构里"共享源 + 每片一份副本"的原因，用 `tools/sync-kit.sh` 保持同步。

---

## 6 设计系统（kit）

把视觉语言抽成 `kit.css` + `kit.js`，每支工程拷一份。**好处**：改一处颜色/曲线，全系列一致。

### 6.1 CSS 层（`templates/kit.css`）

- **色彩变量**：底/墨色三级/主色/强调色/徽标 8 色（示例取自被宣传产品自身的主题变量 → 视频与产品是同一套语言）
- **排版**：`.h1/.h2/.h3/.body/.mono`，关键词高亮 `.mark`（用 DOM 顺序控制层级，**不要用负 z-index**）
- **3D 物块**：`.stage3d > .block > .slab-shadow + .slab > .shotClip > img`
  （物块有厚度伪元素与接触阴影 → 屏幕像"被托起"）
- **材质**：`.glass`（`backdrop-filter` + `mask-composite` 镜面环 + 顶部内高光）、`.grain`（纸纹噪点）
- **转场素材**：`.sweep`（光带）、`.flash`（白闪）、`.inkpanel`（黑场）
- **字幕**：`.subwrap > .subrow > .sub`（**每句独立一行**，见 §12 坑 3）
- **安全区**：`.bg::after` 纸底收口（见 §11）

### 6.2 JS 层（`templates/kit.js`）—— 五个 API 覆盖 90% 需求

| API | 作用 | 关键点 |
|---|---|---|
| `BL.subtitles(tl, cues, {total})` | 按口播语速铺字幕 | 时长由字数推导；返回真实时间轴；同步给 SRT |
| `BL.cursor(scene)` | 动画鼠标 | `appear/to/click/hide`；点击自带按压 + 双层涟漪；**必须初始 `opacity:0`** |
| `BL.cam(tl, img, {at,dur,z,x,y})` | 对真实截图推近特写 | `x,y` 用截图的 CSS 坐标（基准 1600×900）；**只在首次调用写初始态**（见 §12 坑 2） |
| `BL.flow(tl, pathSel, dot, {at,draw,travel})` | 流线引导视线 | 路径**构建期采样**，`onUpdate` 内不做 DOM 测量 |
| `BL.fx.{sweep,flash,flip,circle}` | 光带 / 白闪 / 翻页 / 圆形扩散 | 圆形扩散可复刻产品里的主题切换动画，形成"语言回响" |

### 6.3 设计原则（写进给子代理的规范里）

1. **机位不要全是正面平铺**：用 `.stage3d` 的 `perspective` + `rotationX/rotationY` 做 8°–20° 斜置
2. **光影**：物块下方必须有接触阴影；截图有 1px 内描边；文字有极轻投影
3. **特写**：全片至少 2 次 `BL.cam` 推近到 `z ≥ 1.8`，并**真的对准控件**
4. **转场**：每支至少 3 种，同类不连用；每处转场都要有视觉落点（白闪/光带/翻页）
5. **收尾**：最后一秒留干净画面，方便与下一支衔接
6. **对比度**：浅底正文最浅用 `--ink-2`（≈5.4:1）；**装饰性淡化标记用图形，不要用浅色文字**（对比度审计会拦）

---

## 7 字幕与口播节奏（为后期剪辑准备）

### 7.1 语速模型

| 参数 | 取值 | 说明 |
|---|---|---|
| 中文语速 | **4.3 字/秒** | 正常口播速度（约 258 字/分钟），不是"念字幕" |
| 句间换气 | 0.18 秒 | |
| 单句最短 | 1.5 秒 | |
| 字数统计 | 所有非空白字符（标点计入，天然留出停顿） | ⚠️ 英文按**字符**计（`BiliLearn-AI` = 12 字） |

时长公式：`dur = max(1.5, 非空白字数 / 4.3)`，`end = start + dur`。

**必须做校验**：`end` 不能超过片长，也不能压到下一句的 start。
本次就靠这条抓到了一个真 bug：片头那句 `BiliLearn-AI 宣传片，六段短片。` 需要 4.88 秒，而片子只有 4.6 秒 —— 缩短文案后重渲。

### 7.2 单一数据源

**一份 `assets/cues.json` 同时生成三样东西**，保证画面字幕、SRT、字幕总表**逐帧一致**：

```json
{ "charsPerSecond": 4.3,
  "videos": [
    { "id":"01", "name":"01-开场痛点", "duration":16.6,
      "cues":[ {"t":0.9,"text":"三个小时的网课，笔记还是一片空白。"} ] } ] }
```

- 画面：合成里 `BL.subtitles(tl, CUES, {total})`
- SRT：`node tools/make-srt.mjs`（逐句校验语速）
- 总表 txt：`node tools/make-txt.mjs`（带时间码 + 文末"连读文本"供配音照念）

### 7.3 位置与安全区

字幕放在**画面底部往上 ~104px**（不是贴底 64px）——因为渲染器视口比画布矮 87px（§11），贴底会被裁。
同时这也给剪辑软件留出叠自己字幕条/平台 UI 的空间。

---

## 8 真实界面素材采集（零依赖 CDP）

> 宣传片里"看起来像真的在用产品"的唯一办法：**真的把产品跑起来截图**。

### 8.1 为什么不用 puppeteer

Node 22+ 有内置 `WebSocket`，**直接讲 DevTools Protocol 就行**，不用装 puppeteer（省 100MB+ 且不受版本限制）。
完整脚本见 `templates/capture-ui.mjs`，核心 40 行：

```js
const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`,
                                  { method:'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
// 然后 ws.send(JSON.stringify({id, method:'Page.captureScreenshot', params:{...}}))
```

### 8.2 采集哪些状态（比"截首页"多得多）

| 类别 | 做法 | 价值 |
|---|---|---|
| 基础页面 | 每个路由一张，**2× DPR** | 主素材 |
| 主题变体 | 先写 `localStorage` **再真正重载**（加个 query 参数强制换文档） | 深色/多主题对比 |
| **交互态** | 用 `Runtime.evaluate` 点 tab / 开弹窗后截图 | 最有说服力（思维导图、答疑面板…） |
| 移动端 | 视口 390×844 @3x，`mobile:true` | "三端"叙事 |
| **高视口长图** | 视口设成 1600×2600 再截 | 后面裁任意区域（见 §14 坑） |

> ⚠️ 只改 `localStorage` 再跳同 URL 的 hash 路由**不会重载**，主题不生效。必须让文档真正重新加载。

### 8.3 控件坐标探针（动画鼠标要用）

"鼠标点在按钮上"不能靠肉眼估。用 `getBoundingClientRect()` 把关键控件坐标导成 JSON：

```js
const el = all.find(e => e.textContent.trim() === label);
const r = el.getBoundingClientRect();     // CSS px
```

产出 `assets/rects.json`。映射到画面：

```
画面坐标 = 截图左上角 + (CSS坐标 / 1600) * 截图显示宽度
```

（截图基准 1600×900 CSS → 2× PNG 是 3200×1800。）

### 8.4 版权红线（必须主动处理）

截图里会混进第三方内容（视频播放器、他人视频帧、平台 UI）。规则：

1. **特写一律避开**播放器/缩略图区域，只对准产品自身 UI（笔记、徽标、时间戳、按钮）
2. 需要裁剪时，先在母版上裁掉，再放进工程
3. 对外发布前，建议对不可避免的区域做模糊或替换
4. 交付文档里显式写清这一点（让使用者知道风险与处理方式）

---

## 9 动画与转场工具箱

### 9.1 可动属性实测表

| 属性 | 可用 | 备注 |
|---|---|---|
| `opacity` / `x` / `y` / `scale` / `rotation` | ✅ | 官方"白名单"，最稳 |
| `strokeDashoffset`（SVG 描边生长） | ✅ | 白名单之外也合法 |
| `clipPath`（`inset()` / `circle()` 揭示与擦除） | ✅ | 同上 |
| `width` / `height` | ✅ | 但优先用 `scaleX/scaleY`（性能与缓动更好） |
| `color` / `backgroundColor` | ✅ | 做"选中态迁移"用 |
| SVG `attr:`（如 `r`、`cx`、`d`） | ✅ | 图形形变 |
| `filter: url(#feDisplacementMap)` | ✅ | 液态折射；静态定义 + 动画驱动位移源 |
| CSS `@keyframes` | ❌ | **不可 seek**，禁用 |
| `display` | ⚠️ | 不要做时长补间；`set` 可以 |

### 9.2 转场配方（本次用过的，按"视觉冲击"排序）

| 转场 | 实现 | 适用 |
|---|---|---|
| **页面翻转 flip** | 出：`rotationY:-26, x:-140, scale:.94`；入：`rotationY:24 → 0`，父级 `perspective` | 换界面/换场景 |
| **白闪 flash** | 全屏白 div，`0→0.92`（0.1s）再 `→0`（0.34s） | 关键结果揭示，硬切 |
| **圆形扩散 circle** | `clip-path: circle(0 → 1500px at x y)` | 主题反转，可复刻产品自身动效 |
| **光带扫过 sweep** | 26% 宽斜向白光条 `x: -520 → 1920`，两端淡出 | 段落推进 |
| **网格碎裂** | 内容切 N 列，各自 `rotation` + 位移 + `stagger` | 数据/文本被"切块处理" |
| **磁吸聚合** | 多元素向心位移，末端 1 帧白闪 | 汇总/合并 |
| **缩放穿透** | 目标元素 `scale → 4×` 后换场 | 从按钮进入下一层 |

**纪律**：同类转场不连用；每支最多引入 2 种新转场；**每处转场配一个视觉落点**（不然看不见）。

---

## 10 校验闭环（四个命令，分工不同）

```bash
source ./env.sh

"$HF_BIN" check .        # 静态 + 运行时 + 布局 + 运动 + WCAG 对比度（最全，必过）
"$HF_BIN" snapshot . --at 2,6,10,14   # 抽关键帧 PNG，快速目视
"$HF_BIN" render . -o renders/x.mp4 -f 30 --quality looks --workers 2
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,nb_frames \
         -show_entries format=duration -of default=nw=1 renders/x.mp4
```

### 10.1 必须知道的三个"骗人"之处

1. **lint 报 error 会关掉布局/运动/对比度审计** → 输出 `0 sample(s)` / `0/0 text checks`，
   看着像"全绿"，实际**什么都没验**。看到 0 样本要警惕。
2. **`check` 不认 `-c` 参数**，它只校验工程入口 `index.html`
   → 要校验某支子工程，进它自己的目录跑 `check .`（这就是"一片一工程"的另一个好处）。
3. **`snapshot` 会滞后于快速镜头运动**（截图跟随虚拟时钟有延迟）
   → **验收一律抽 MP4 的帧**：
   ```bash
   ffmpeg -ss 9.2 -i renders/x.mp4 -frames:v 1 /tmp/f.png
   ```

### 10.2 像素测量（别用眼睛判断"看不太出来"）

本次两个被眼睛漏掉、靠测量抓出来的问题：

- **底边色差接缝**：逐行取平均灰度，比较接缝上下 2 行的差值（本次 14/255 → 修到 0–2/255）
- **字幕被裁**：数"深色像素行"范围，看胶囊底边是否落在安全线内

```python
from PIL import Image
im = Image.open('/tmp/f.png').convert('RGB'); px = im.load()
def avg(y, x0=60, x1=300):
    s=n=0
    for x in range(x0,x1,4):
        p=px[x,y]; s+=(p[0]+p[1]+p[2])//3; n+=1
    return s//n
print(avg(992), avg(1002))     # 接缝差
```

---

## 11 渲染器限制：视口比画布矮 87px（**本机实测，必读**）

### 11.1 现象

producer 用 `--window-size=W,H` + 新版 headless 启动 Chrome，**实际视口 = 窗口高 − 87px**（浏览器边框）。
后果：1080 画布只有**顶部 993px 被真正绘制**，其余由画布底色填充。

验证方法（逐行取平均色，看是否出现平坦带）：

```
01@11.4  从 y=993 到 1079 全为纯底色（87 px 空白带）
05@8.0   从 y=993 到 1079 全为纯底色（87 px 空白带）
```

### 11.2 试过但不可行的方案

- 下载 `chrome-headless-shell` 并用 `PRODUCER_HEADLESS_SHELL_PATH` 指向它（旧版 headless 无视口边框）
  → **与本版 producer 不兼容**：`Navigating frame was detached` + GPU 探测失败。（白下 200MB，已删）

### 11.3 采用的方案（纯 CSS 适配，不动渲染器）

1. **地平线收口**：让底部渐变在到达该线前收敛成**画布底色**，跨接缝色差降到 0–2/255
   ```css
   .bg::after{content:"";position:absolute;left:0;right:0;bottom:0;height:240px;
     background:linear-gradient(180deg, rgba(底,0) 0%, rgba(底,.92) 52%, 底 100%)}
   ```
2. **字幕进安全区**：`.subrow{bottom:104px}`（不是 64px）
3. **所有内容设计在 `H−87` 以内**；靠底部的元素要显式检查

> 换机器/升级 producer 后要**重新测量**这条限制（可能是不同的像素数，甚至不存在）。

---

## 12 踩坑总表（症状 → 根因 → 修法）

> 这是本文档最有价值的部分。每条都是本次真实发生过的。

| # | 症状 / lint 报错 | 根因 | 修法 |
|---|---|---|---|
| 1 | `EPERM mkdir '~/.cache/hyperframes'` | 沙箱不允许写 `~` | HOME 重定向进工程（§1.2） |
| 2 | `npm error EPERM ~/.npm/_cacache` | 同上 | `--cache ./.npm-cache` |
| 3 | **左上角常驻一个鼠标指针** | kit 的 `.cursor` 缺初始 `opacity:0` | 加 `opacity:0`；`appear()` 时才淡入 |
| 4 | **冷启动帧已经被放大/已到位** | `BL.cam` 在构建期就把"最后一次相机状态"写进了 DOM | 只在**首次**调用时写初始态，之后全靠 tween 的 `onUpdate` |
| 5 | **多条字幕挤成一行、偏心、换行** | 所有 `.sub` 是 flex 容器的兄弟节点 → 并排+压缩 | 每句包一层 `.subrow`（绝对定位 + flex 居中） |
| 6 | `font_family_without_font_face` | 声明了系统字体但没 `@font-face` | `@font-face{font-family:"PingFang SC";src:local("PingFang SC")}` |
| 7 | `gsap_css_transform_conflict` | CSS 里写了 `transform: scaleX(0)`，GSAP 又动 `scaleX` | 删掉 CSS transform（或改用 `fromTo`，它豁免） |
| 8 | `gsap_cold_seek_hidden_fromto_missing_reveal` | 元素初始隐藏，`fromTo` 的**目标态**没写 `opacity` | 目标态显式补 `opacity:1` |
| 9 | `gsap_repeated_fromto_without_baseline` | 同一元素多次 `fromTo`，后者把"起始态"提前写进 DOM | 除最早一条外都加 `immediateRender:false` |
| 10 | `overlapping_gsap_tweens` | 同一属性两个 tween 时间重叠 | 缩短前者或后移后者 |
| 11 | `gsap_callback_dom_measurement` | `onUpdate` 里调 `getTotalLength/getBoundingClientRect` | 构建期采样（`BL.samplePath`），回调里只读数组 |
| 12 | `negative_z_index` | 用 `z-index:-1` 做背景层 | 改用 **DOM 顺序**（背景元素在前）+ 需要时 `isolation:isolate` |
| 13 | `invalid_parent_traversal_in_asset_path` | 子目录合成引用 `../assets/...` | 每个工程内放一份 `assets/`，写 `assets/...` |
| 14 | `multiple_root_compositions` | 根目录多个带 `data-composition-id` 的 HTML | 一个根工程 + 其余放子目录（§5） |
| 15 | **对比度不达标**（`✗ ... 2.32:1 (need 4.5:1)`） | 深色小字/低透明文字压在浅底 | 浅底正文最浅 `--ink-2`；淡化标记改图形 |
| 16 | **淡出帧被判对比度失败** | 淡出从片长 87% 就开始了，被审计采样到 | 淡出只占最后 ~6%（片头从 4.6s 加长到 5.6s 才解决） |
| 17 | 淡入帧被判失败 | 首个采样点落在淡入过程中 | 让淡入**早于**片长的 5.6%（`duration*(0.5/9)`） |
| 18 | `content_overlap` / `text_occluded` / `container_overflow` / `escaped_container` | 有意叠放/溢出/被转场遮住 | 修，或**显式声明意图**：`data-layout-allow-overlap` / `-allow-overflow` / `-allow-occlusion` |
| 19 | 渲染日志 `media_load_failed` | 素材路径错（把 png 换成 jpg 后忘了改引用） | 改完素材扩展名要全局搜引用 |
| 20 | **底边出现横向色差接缝** | 视口 87px 限制（§11） | `.bg::after` 收口 |
| 21 | **新渲染的帧是空的/半成品** | 子代理还在改 `index.html` 时你就渲染了 | 渲染前 `stat` 一下源文件 mtime 与产物 mtime |
| 22 | 并行多个渲染把机器拖死 | 每个 worker 一个 Chrome（~256MB） | `--workers 2`，串行跑多支 |
| 23 | 封面高亮环/标注对不准 | 目标位置用 DOM 坐标算，与截图会话不一致 | 见 §14：**同会话探针 + 图像坐标系** |
| 24 | 裁剪出来的区域混进不该有的内容 | 源截图高度不够，`ffmpeg crop` **静默截断**了偏移 | 用高视口（如 1600×2600）截长图，再裁 |

---

## 13 多智能体并行生产（怎么把 6 支片子同时做出来）

### 13.1 分工

1. **主控先做完一支样板片**（含 kit、素材、校验、渲染全部跑通）—— 它是"活的规范"
2. 写一份 `SPEC.md`（见 `templates/任务书SPEC模板.md`），规定：设计系统、硬约束、必用手法、验收标准
3. 每支片子派一个子代理，**各自独立工程目录**，任务书里明确"只改这个目录"
4. 子代理返回：片名、时长、`check` 结论行、渲染文件大小、ffprobe 数字、用了哪些转场

### 13.2 任务书必须包含（缺一项就会返工）

- ✅ 指向样板片与 kit 的**具体路径**（"先读这三样"）
- ✅ **该片的字幕文案与时间**（从 `cues.json` 抄，明说"不得改动时间"）
- ✅ **可用素材清单**（哪个截图对应哪个叙事）
- ✅ **必须出现的手法清单**（3D 物块/特写/光标/流线/翻页…）
- ✅ **硬约束清单**（§12 的坑逐条转成"禁止/必须"）
- ✅ **验收命令**（`check` → `snapshot` 目视 → `render` → `ffprobe` → 抽帧目视）
- ✅ **版权红线**（特写避开第三方画面）

### 13.3 协作陷阱（真实发生）

| 陷阱 | 表现 | 对策 |
|---|---|---|
| 用主控的渲染覆盖了子代理成果 | 我提前渲染 04，渲到半成品 | 接受前先比对源文件与产物的 mtime |
| 子代理各自为政改 kit | 视觉走样 | 明确"kit 只读"，需要新样式就写在自己 HTML 里；主控统一 `sync-kit.sh` |
| 子代理长期反复迭代 | 交付物一直在变 | 验收通过后主动 `interrupt_agent`，冻结产物 |

---

## 14 封面制作（点击率的最大变量）

### 14.1 比例与安全区（**投流前必看**）

| 平台位 | 实际展示比例 | 建议 |
|---|---|---|
| B站信息流（视频封面） | **16:9** | 主投流用 16:9；4:3 会被裁成中间带（如 1600×1200 的 y 150–1050） |
| 其它位（动态/相册部分场景） | 4:3 可用 | 另出一版 |

**做法**：同一套 HTML 出两个文件（改画布尺寸 + 重排几何），别指望一张图两个比例都好看。

### 14.2 高点击率构图（实测有效）

1. **缩略图尺寸（300px 宽）下只有数字能读**：把最值钱的对比放在最前（如「3 小时 → 12 分钟」）
2. **冷暖对撞**：左边红（痛苦）右边青（解决），颜色自己讲故事
3. **两张贴纸分工**：红贴纸制造共鸣，黄贴纸做人群筛选（如「开源免费」）
4. **下半屏放真实界面**，并用**高亮环**标出核心卖点
5. **深底 + 高饱和高光**，在白底信息流里跳得出来
6. 自检：把成图缩到 300px 看一眼，还读得出的信息才算"钩子"

### 14.3 两个技术要点（否则高亮环永远套不准）

**(a) 高亮环必须画在"图像坐标系"里**，不要画在页面坐标系：
把图和一个 `position:relative` 的包裹层放一起，环用**百分比**定位在包裹层内：

```html
<div class="imgwrap">              <!-- 高度 = 图片渲染高度 -->
  <img src="panel.jpg">
  <div id="ring"></div>            <!-- left/top/width/height 用 % -->
</div>
```
这样物块的 3D 旋转、透视、缩放全都会**同步作用于环**，永远对齐。

**(b) 目标坐标要与截图"同会话"取**：
DOM 探针与截图必须**在同一次浏览器会话、同一视口**里做，否则内容位置会漂。
本次就吃过亏：用另一会话的 DOM 坐标算 y，结果偏了 280px。

先算好百分比：
```
left% = (cssX * DPR - cropX) / imgW - padX
top%  = (cssY * DPR - cropY) / imgH - padY
```

**(c) 静帧截图工具**：`templates/shoot-cover.mjs`（把任意 HTML 截成 PNG，可指定 DPR）
```bash
node tools/shoot-cover.mjs cover/cover-16x9.html 1600 900 2   # 出 3200×1800
```

---

## 15 后期对接（把片子交给剪辑/配音的人）

交付时**必须一起给**的东西：

| 文件 | 用途 |
|---|---|
| `NN-片名.mp4` | 正片（按序编号命名） |
| `NN-片名.srt` | 逐句字幕，与画面字幕同源同时间 |
| `字幕总表.txt` | 带时间码的逐句表 + 文末"连读文本"（配音照念） |
| `系列总览-all-in-one.mp4` | 顺序拼接，用于通看 |
| `系列对比图.png` | 每支一帧，快速索引 |
| `README.md` | 交付说明：规格、素材来源、重渲方法、版权提醒 |

**拼接**（同编码参数才能无损 `-c copy`）：
```bash
: > /tmp/list.txt
for f in renders/0*.mp4; do echo "file '$PWD/$f'" >> /tmp/list.txt; done
ffmpeg -f concat -safe 0 -i /tmp/list.txt -c copy renders/all-in-one.mp4
```

**无音轨的提醒**：纯无声视频在短视频平台完播率吃亏 → 要么按 SRT 配旁白，要么至少铺 BGM。这事要主动告诉需求方。

---

## 16 交付检查清单

见 `交付检查清单.md`（可打印逐项打勾）。

---

## 17 模板与工具索引

| 文件 | 说明 |
|---|---|
| `templates/env.sh` | 沙箱环境包装（HOME 重定向 + 系统 Chrome + 关遥测） |
| `templates/kit.css` / `kit.js` | 设计系统 + 运行时（字幕/光标/镜头/流线/转场） |
| `templates/合成骨架.html` | 最小可跑合成，直接改内容 |
| `templates/探针合成.html` | 能力探针模板（含对照组写法） |
| `templates/任务书SPEC模板.md` | 派给子代理的任务书模板（§13.2 的落地版） |
| `tools/capture-ui.mjs` | 真实界面采集（主题变体、交互态、移动端） |
| `tools/probe-rects.mjs` | 控件坐标探针 → `rects.json` |
| `tools/make-srt.mjs` / `make-txt.mjs` | 字幕导出（SRT / 总表 txt）+ 语速校验 |
| `tools/shoot-cover.mjs` | 任意 HTML → PNG（封面/静帧，可指定尺寸与 DPR） |
| `tools/render-all.sh` / `assemble-series.sh` | 批量渲染 / 拼接总览与对比图 |
| `tools/sync-kit.sh` | 把主 kit 同步到每支工程 |
| `tools/scaffold-films.sh` | 按片名批量生成独立工程骨架 |

---

## 18 资源实测数据（用于估工期）

| 项目 | 实测 |
|---|---|
| 渲染 1080p/30fps | 300 帧（10s）≈ 17s，5 workers；500–600 帧（17–20s）≈ 30–60s，2 workers |
| 单支 17–20 秒成片体积 | 5–11 MB（CRF 16，`--quality looks`） |
| `check` 一次 | 10–40 秒（起一次浏览器会话） |
| 界面截图采集 | 15 张 ≈ 40 秒（含等待渲染） |
| 封面出图 | 每张 ≈ 3 秒 |
| 一次典型返工成本 | 改文案 + 重渲一支 ≈ 1–2 分钟 → **所以校验要早、要自动化** |

---

## 19 一页速查（贴在显示器上那种）

```
开工三步：探针 → 字幕时间轴 → 一片一工程
动画铁律：GSAP 唯一驱动 / 不测 DOM / 不用墙钟随机
进度闭环：check（必 0 error）→ snapshot 目视 → render → 抽 MP4 帧 + 像素测量
安全区：  底部留 87px，字幕 bottom:104px，淡出只在最后 6%
交付五件：MP4 + SRT + 字幕总表 + 总览 + README（含版权提醒）
```
