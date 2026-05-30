# PR 记录

## PR 01: 初始化项目与基础 MVP
- **分支**: `feature/init-mvp`
- **功能**: 项目骨架、四个平台适配器、模拟发布、基础 UI
- **核心文件**: `index.html`, `src/app.js`, `src/core/adapters.js`, `src/core/publisher.js`
- **验证**: `npm test` 通过，浏览器可看到四平台适配结果

## PR 02: 增强发布工作台流程
- **分支**: `feature/enhanced-workflow`
- **功能**: 草稿保存、质量评分、排期、Markdown/JSON 导出、发布日志
- **核心文件**: `src/core/adapters.js` (质量评分), `src/core/publisher.js` (排期), `scripts/serve.js`
- **验证**: 浏览器验证排期、复制、导出和模拟发布

## PR 03: 补充架构和演示材料
- **分支**: `docs/architecture-materials`
- **功能**: 架构文档、demo 脚本、提交检查清单
- **核心文件**: `docs/architecture.md`, `docs/demo-script.md`, `docs/submission-checklist.md`
- **验证**: 文档完整性检查

## PR 04: 自定义平台与 AI 提示词包
- **分支**: `feature/custom-platforms`
- **功能**: 自定义平台注册表、通用适配器、AI 提示词生成、内容模板库
- **核心文件**: `src/core/templates.js`, `src/core/strategy.js`
- **验证**: 页面内添加抖音等平台，生成适配文案和 AI 提示词

## PR 05: 发布准备度看板与策略建议
- **分支**: `feature/readiness-dashboard`
- **功能**: 发布准备度看板（可发布/需优化/阻塞）、推荐主平台
- **核心文件**: `src/app.js` (renderReadiness), `src/core/strategy.js`
- **验证**: 四平台状态展示正确

## PR 06: 导出增强（日历/CSV/平台预设/规则）
- **分支**: `feature/export-enhancements`
- **功能**: iCal 日历导出、CSV 报告、平台预设导入导出、规则 Markdown 导出
- **核心文件**: `src/core/calendar.js`, `src/core/reports.js`, `src/core/rules.js`, `src/core/platform-presets.js`
- **验证**: `npm test` 新增导出测试全部通过

## PR 07: Markdown 导入与草稿版本快照
- **分支**: `feature/markdown-snapshots`
- **功能**: Markdown 文件解析导入、草稿版本保存/恢复（最多 12 个版本）
- **核心文件**: `src/core/markdown.js`, `src/core/snapshots.js`
- **验证**: 导入 .md 文件验证解析正确，快照恢复功能正常

## PR 08: PWA 离线支持
- **分支**: `feature/pwa-offline`
- **功能**: Service Worker 缓存、manifest、离线可用
- **核心文件**: `service-worker.js`, `manifest.webmanifest`, `assets/icon.svg`
- **验证**: Chrome DevTools 确认 SW 注册成功

## PR 09: 后端服务初始化
- **分支**: `feature/backend-server`
- **功能**: Express 服务器、API 路由框架、静态文件服务、健康检查
- **核心文件**: `backend/server.js`, `backend/package.json`
- **验证**: `curl /api/health` 返回 OK

## PR 10: 微信公众平台真实发布 API
- **分支**: `feature/wechat-publish`
- **功能**: access_token 管理、图片上传、草稿创建（draft/add）、草稿发布（freepublish/submit）
- **核心文件**: `backend/services/wechat-api.js`, `backend/routes/wechat.js`
- **验证**: 配置真实 AppID/AppSecret 后成功创建公众号草稿

## PR 11: 凭证管理系统
- **分支**: `feature/credential-management`
- **功能**: 凭证 CRUD、本地加密存储、前端账号设置面板
- **核心文件**: `backend/storage/credentials-store.js`, `backend/routes/credentials.js`
- **验证**: 页面内保存/删除凭证，状态实时更新

## PR 12: 知乎浏览器自动化发布
- **分支**: `feature/zhihu-browser`
- **功能**: Puppeteer 打开知乎专栏写作页、自动填写标题正文标签
- **核心文件**: `backend/services/zhihu-browser.js`, `backend/routes/zhihu.js`
- **验证**: 登录知乎后一键发布到专栏

## PR 13: B站浏览器自动化发布
- **分支**: `feature/bilibili-browser`
- **功能**: Puppeteer 打开B站创作中心、Cookie 持久化、自动填写专栏编辑器
- **核心文件**: `backend/services/bilibili-browser.js`, `backend/routes/bilibili.js`
- **验证**: 扫码登录后一键发布到B站专栏

## PR 14: 小红书真实发布
- **分支**: `feature/rednote-publish`
- **功能**: `@lucasygu/redbook` (XhsClient) API 优先发布 + DOM 坐标点击 fallback、智能发布按钮检测
- **核心文件**: `backend/services/rednote-browser.js`, `backend/routes/rednote.js`
- **验证**: API 方式成功创建小红书笔记

## PR 15: UI 设计系统升级 v2
- **分支**: `feature/ui-redesign`
- **功能**: SaaS 工作台风格、工作流进度条、平台色卡片、发布驾驶舱、微交互
- **核心文件**: `src/styles.css`, `index.html`, `src/app.js`
- **验证**: 浏览器验证新 UI，移动端响应式正常

## PR 16: 前端集成真实发布
- **分支**: `feature/real-publish-ui`
- **功能**: publisher.js 扩展真实/模拟双模式、发布结果内联展示、一键发布按钮增强
- **核心文件**: `src/core/publisher.js`, `src/app.js`
- **验证**: 有凭证走真实 API，无凭证 fallback 模拟发布
