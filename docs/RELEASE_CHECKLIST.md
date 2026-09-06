# 发布检查清单

## 运行前
- [ ] 微博 Cookie / 模型配置 / 平台选择 已就绪
- [ ] `node --check electron/main.cjs electron/preload.cjs electron/backend/*.js` 通过
- [ ] `cd desktop/web && npm run build` 通过（包含 TypeScript 构建）
- [ ] Electron 桌面端可启动，健康检查接口正常

## 桌面端
- [ ] `cd desktop/web && pnpm install --frozen-lockfile && pnpm run build` 成功
- [ ] `cd electron && npm ci && npm start` 可启动
- [ ] 浏览器访问 `http://127.0.0.1:8765` 页面正常
- [ ] 图片发现 → 搜索 → 下载 → 评分 流程正常
- [ ] 文章发布 → 灵感搜索 → AI 生成/润色 → 保存草稿 流程正常
- [ ] 文章发布 → 封面搜索/下载 → 加入发布队列 流程正常
- [ ] 发布队列 → 生成文案 → 保存公众号草稿 流程正常
- [ ] 本地素材 → 浏览/移动/删除 流程正常
- [ ] 设置 → AI 连通性测试、微博登录校验、微信公众号多账号登录状态 正常

## 风控与安全
- [ ] `REQUIRE_CONFIRM=true`（生产环境）
- [ ] 发布频率控制（`PUBLISH_INTERVAL_SECONDS`）已设置
- [ ] 水印策略配置复核
- [ ] 默认公众号账号已确认；多账号场景下逐项确认 `account_id`
- [ ] API Key、Cookie、`data/state/*` 不进入提交或发布说明

## 发布产物
- [ ] 推送到 `main` 后由 GitHub Actions 自动递增 `electron/package.json` 版本（前端通过构建注入 `__APP_VERSION__`）
- [ ] GitHub Actions 自动创建 `v{version}` tag、构建 macOS DMG/ZIP 和 Windows 安装包，并上传 `latest*.yml` 到 Release
- [ ] 输出更新说明与已知问题
