# MediaForge · 图文工坊

![构建状态](https://img.shields.io/github/actions/workflow/status/abner-forever/MediaForge/build.yml?branch=main&logo=github&label=%E6%9E%84%E5%BB%BA)
![版本](https://img.shields.io/github/v/release/abner-forever/MediaForge?logo=semver&label=%E7%89%88%E6%9C%AC)
![Node](https://img.shields.io/badge/Node.js-22%2B-green)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)

微信公众号内容自动化工具。多平台图文发现 → 水印过滤 → AI 评分与写作 → 草稿管理 → 一键发布。

> **免责声明**：本项目仅供学习交流和技术研究使用。使用本工具时请遵守相关平台的服务条款和当地法律法规，用户需自行承担因使用本工具产生的一切风险和责任，项目作者不对任何直接或间接损失负责。

<!-- screenshots placeholder -->
<!-- ![桌面 GUI 预览](docs/screenshots/gui.png) -->

## 功能特性

| 类别 | 功能 |
|------|------|
| **多平台发现** | 微博（明星/时间线/超话/关键词）、今日头条（feed/用户/关键词）、小红书 |
| **扫码登录** | 微博/头条/小红书/公众号均支持内置 WebView 扫码，无需手动复制 Cookie |
| **智能过滤** | 边缘检测水印过滤、AI 图片评分、Vision API + 启发式回退 |
| **AI 内容生产** | 标题生成、正文撰写、校对润色、去 AI 味、排版优化、对话式改写 |
| **文章工作台** | Markdown 编辑、封面选择、草稿管理、发布队列、效果追踪 |
| **公众号管理** | 多账号独立 profile、发布历史、阅读数据同步、数据分析 |
| **素材管理** | 文件夹浏览、重命名、批量操作、元数据标记（标签/评分/使用记录） |
| **双模式** | 命令行批量处理 + 桌面 GUI 交互式管理，Electron 原生窗口 |
| **主题系统** | 浅色/深色/跟随系统，4 套配色可切换 |

## 快速开始

### 环境准备

```bash
cd desktop/web && pnpm install
cd ../electron && npm install
```

推荐使用桌面 GUI 的**设置页面**完成配置，也支持环境变量。

### 核心配置

| 变量 | 说明 |
|------|------|
| `AI_API_KEY` | AI 模型 API Key（Mimo / DeepSeek / GLM / OpenAI / Qwen / MiniMax） |
| `AI_BASE_URL` | OpenAI 兼容 API 地址 |
| `WEIBO_COOKIE` | 微博登录 Cookie（桌面版可通过扫码获取） |
| `WEIBO_CELEBRITIES` | 明星列表（逗号分隔） |

> 完整配置项（含水印过滤、发布控制等进阶参数）可在桌面端设置页完成。

### 桌面 GUI 模式（推荐）

后端已经迁移到 Electron/Node，不再依赖 Python。Electron 主进程会同时启动 Node HTTP 服务和浏览器窗口。

```bash
# 1. 构建 React 前端
cd desktop/web
pnpm install
pnpm run build

# 2. 启动 Electron
cd ../electron
npm install
npm start
```

也可以单独启动 Node 后端并通过浏览器访问 `http://127.0.0.1:8765`：

```bash
cd electron
node -e "require('./backend').startServer(8765)"
```

### 命令行模式

原来的批量处理流程已并入 Electron 桌面端，使用桌面 GUI 即可完成发现、AI 创作和发布。

### 前端开发

```bash
cd desktop/web
pnpm install
pnpm run dev    # Vite 热更新，端口 5173，API 代理到 8765
```

### 打包桌面应用

最简单的方式：

```bash
bash build_local.sh
```

手动构建：

```bash
cd desktop/web && pnpm install --frozen-lockfile && pnpm run build
cd ../electron
npm ci
npm run dist
```

推送到 `main` 分支会自动触发 GitHub Actions 构建，详见 `.github/workflows/build.yml`。

### Electron 自动更新

打包版通过 `electron-updater` 从 GitHub Releases 检查更新。GitHub Actions 会构建 macOS 和 Windows 安装包，并把 `latest.yml` / `latest-mac.yml` 与安装包一起上传到 Release。

发布新版本时更新 `electron/package.json` 的 `version` 字段，推送到 `main` 后 GitHub Actions 会创建 Release。

> macOS 自动更新需要已签名且开启 Hardened Runtime 的应用。当前公开工作流默认构建未签名产物，主要用于测试和自用；如果要面向外部分发 macOS 自动更新，请在仓库 secrets 中配置 `CSC_LINK`、`CSC_KEY_PASSWORD` 和 Apple 证书。

## 平台支持

| 平台 | 模式 | 说明 |
|------|------|------|
| **微博** | `own` / `celebrities` / `mixed` / `super_topic` / `keyword` | 明星时间线聚合、超话、关键词搜索 |
| **今日头条** | `feed` / `user` / `keyword` | feed 模式因签名限制会回退到关键词搜索 |
| **小红书** | `search` | Playwright 拦截带签名的 API，需要登录 |

平台抓取逻辑已经迁入 `electron/backend`，新增平台只需要在 Node 后端中注册对应 service。

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js, Express |
| 前端 | React 18, TypeScript, Vite, Tailwind CSS, Zustand |
| 浏览器自动化 | Playwright (Chromium) |
| AI | OpenAI 兼容 API（Mimo/DeepSeek/GLM/OpenAI/Qwen/MiniMax） |
| 编辑器 | CodeMirror + Markdown，Tiptap JSON 兼容层 |
| 桌面壳 | Electron + electron-builder + electron-updater |

## 项目结构

```
MediaForge/
├── desktop/
│   └── web/                 # React 前端源码
│       └── src/
│           ├── pages/       # 7 个工作区页面
│           ├── components/  # UI 组件
│           ├── api/         # API 客户端（按域拆分）
│           └── stores/      # Zustand 状态管理
├── electron/                # Electron 主进程、Node 后端、自动更新和打包配置
│   ├── main.cjs
│   ├── preload.cjs
│   ├── backend/             # Express API、状态存储和平台服务
│   └── electron-builder.yml
└── data/                    # 运行时数据（图片/缓存/日志/鉴权）
```

## 常见问题

<details>
<summary><b>Playwright 安装失败？</b></summary>

```bash
# macOS
playwright install chromium

# 如果权限报错
sudo playwright install-deps chromium
```

打包版本已内置浏览器引擎，无需额外安装。
</details>

<details>
<summary><b>各平台 Cookie 怎么获取？</b></summary>

推荐使用桌面 GUI 内置的扫码登录功能，无需手动获取 Cookie。登录后 Cookie 自动保存到本地。

手动获取：浏览器登录对应平台 → F12 开发者工具 → Application → Cookies → 复制全部。
</details>

<details>
<summary><b>AI 服务报错 API Key 无效？</b></summary>

1. 确认在设置页配置了正确的 API Key
2. 如果使用国内供应商（Mimo/DeepSeek/GLM/Qwen/MiniMax），需要配置对应的 Base URL
3. 检查 Key 余额是否充足
</details>

<details>
<summary><b>公众号发布失败？</b></summary>

1. 确认公众号已登录（设置页扫码）
2. Cookie 可能已过期，重新登录即可
3. 检查日志文件（桌面 GUI → 日志管理）获取详细错误信息
</details>

## 贡献与反馈

- Bug 报告 / 功能建议：[GitHub Issues](https://github.com/abner-forever/MediaForge/issues)
- 代码贡献：欢迎 Pull Request，建议先开 Issue 讨论方案

## 许可证

本项目采用 [MIT License](LICENSE) 开源。
