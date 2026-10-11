# 部署指南

Web / PWA 版是一个**完全自包含的静态站点**，没有任何服务端依赖。
把它部署到公网并获得一个可访问的 URL，只需要三步。

---

## 1. 构建

```bash
node scripts/build.mjs
```

产物在 `dist/`，约 440 KB，目录结构：

```
dist/
├── index.html              入口
├── manifest.webmanifest    PWA 清单
├── sw.js                   Service Worker（离线预缓存）
├── styles/app.css
├── src/                    应用代码（原生 ES Module）
├── core/                   核心逻辑（构建时从 packages/core 复制而来）
└── assets/                 图标与封面
```

本地预览：

```bash
node scripts/serve.mjs dist
# 打开 http://127.0.0.1:5180/
```

> **不要直接双击 index.html。** `file://` 协议下 Service Worker 与「添加到主屏幕」都不可用，
> 请始终通过 http(s) 访问。

---

## 2. 部署到公网

### 方式一：GitHub Pages（免费，适合开源项目）

仓库已内置工作流 `.github/workflows/deploy-pages.yml`。步骤：

1. 把代码推送到 GitHub 仓库的 `main` 分支；
2. 进入仓库 **Settings → Pages**，把 **Source** 设为 **GitHub Actions**；
3. 等待 Actions 跑完，站点会发布在
   `https://<你的用户名>.github.io/<仓库名>/`。

不需要做任何路径配置 —— 应用内部全部使用**相对路径**，可以部署在任意子路径下。

### 方式二：Vercel / Netlify

两个平台都可以直接连接 Git 仓库：

| 配置项 | 值 |
| --- | --- |
| Build Command | `node scripts/build.mjs` |
| Output Directory | `dist` |
| Node Version | 18 或更高 |

也可以直接把 `dist/` 目录拖拽到 Netlify 的部署页面完成一次性发布。

### 方式三：自建服务器 / 对象存储

把 `dist/` 整个目录上传即可。以 Nginx 为例：

```nginx
server {
    listen 443 ssl;
    server_name your-domain.example;

    root /var/www/xideng/dist;
    index index.html;

    # Service Worker 必须不被缓存，否则用户会卡在旧版本
    location = /sw.js {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # 带内容哈希之外的静态资源可以长缓存
    location ~* \.(png|svg|css)$ {
        expires 7d;
        add_header Cache-Control "public";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

对象存储（OSS / COS / S3）同样只需开启静态网站托管并上传 `dist/`。

---

## 3. HTTPS 是必须的

| 能力 | 是否需要 HTTPS |
| --- | --- |
| 正常浏览界面 | 否 |
| **Service Worker（离线可用）** | **是** |
| **添加到主屏幕 / PWA 安装** | **是** |
| **Wake Lock（屏幕唤醒锁）** | **是** |

`localhost` 与 `127.0.0.1` 被浏览器视为安全上下文，因此本地开发不需要证书。
但**公网部署必须是 HTTPS**，否则离线能力与 PWA 安装都会静默失效
（代码里对这一点做了处理：非安全上下文下会跳过 Service Worker 注册并输出一条 info 日志）。

---

## 4. 安装为 PWA（推荐给用户的操作）

### Android（Chrome / Edge）
1. 用浏览器打开站点；
2. 点右上角菜单 → 「**添加到主屏幕**」/「安装应用」；
3. 从主屏幕图标启动，会以 **standalone 模式全屏运行**，没有浏览器地址栏。

### iOS（Safari）
1. 用 **Safari** 打开站点（必须是 Safari，Chrome for iOS 不支持）；
2. 点底部分享按钮 → 「**添加到主屏幕**」；
3. 从主屏幕图标启动。

### 桌面（Chrome / Edge）
1. 打开站点；
2. 地址栏右侧会出现安装图标，点击即可安装为独立窗口应用。

安装后配合熄灯模式，体验最接近原生。

---

## 5. 上线前自查清单

把地址分享给别人之前，建议逐项确认：

1. **必须是 HTTPS**，否则 Service Worker、Wake Lock 与「添加到主屏幕」都会静默失效；
2. **无需登录即可访问** —— 这个产品没有任何账号体系，一个有登录墙的部署一定是配错了；
3. 打开站点能直接看到「**立即体验熄灯模式**」按钮，**不需要等到 23:00**；
4. 「添加到主屏幕」后能全屏独立运行；
5. **断网后刷新仍能打开**（Service Worker 预缓存生效）；
6. «/sw.js» 能正常返回内容；
7. 站点内没有任何指向第三方的强制跳转或外链资源。

---

## 6. 常见问题

### 打开后是白屏
打开浏览器控制台查看报错。最常见的原因是**用 `file://` 直接打开了 index.html** ——
请改用 `node scripts/serve.mjs dist`。

### Service Worker 没有生效
- 确认是 HTTPS 或 localhost；
- 打开 DevTools → Application → Service Workers 查看状态；
- 修改过资源后如果仍是旧内容，点「Update on reload」或清除站点数据。

### AI 文案测试连接失败
- 浏览器会拦截跨域请求。若你使用的是自建接口，需要在服务端返回
  `Access-Control-Allow-Origin`；
- `401 / 403` 通常是 Key 或模型权限问题；
- `网络不可达` 也可能是接口地址末尾多了斜杠或路径写错（代码会自动去掉末尾斜杠）。

### 部署在子路径下样式丢失
不应该发生 —— 应用内部全部使用相对路径。若确实出现，请检查是否有反向代理
改写了 `index.html` 的 `<base>` 或注入了绝对路径。

---

## 7. 原生端部署

Android 与桌面端的构建方式见各自目录的 README：

- `platforms/android/README.md`
- `platforms/desktop/README.md`
