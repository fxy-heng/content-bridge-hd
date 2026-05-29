# 评审规则对照表

## 作品完整度与创新性 40%

对应材料：

- 可运行应用：`index.html`、`src/app.js`
- 多平台适配：公众号、知乎、B站、小红书
- 自定义平台扩展：页面内可添加新平台
- 发布准备度看板：集中展示可发布、需优化、阻塞状态
- AI 提示词包：每个平台生成可复制提示词
- 工作区导入导出：支持长期使用和跨设备迁移
- 内容模板库：支持从常用创作场景快速开始
- 发布策略建议：帮助用户决定主平台和优化顺序

创新点：

- 不只做文案转换，而是覆盖输入、适配、校验、排期、模拟发布、日志和复用。
- 用平台注册表同时支持内置平台和用户自定义平台。
- 不绑定具体大模型服务，通过提示词包兼容任意 AI 工具。

## 开发过程与质量 40%

对应材料：

- 核心逻辑：`src/core/adapters.js`、`src/core/publisher.js`
- 测试：`test/adapters.test.js`
- 烟测：`scripts/smoke.js`
- CI：`.github/workflows/ci.yml`
- 本地验证：`npm run check`、`npm test`
- PR 模板：`.github/pull_request_template.md`
- PR 草案：`docs/pr-records.md`
- Commit 计划：`PR_COMMIT_PLAN.md`

质量点：

- 平台规则与 UI 分离。
- 适配、校验、发布、评分均可独立测试。
- 无第三方运行依赖，降低部署和评审复现风险。
- Git 历史保持多个有意义提交。

## 演示与表达 20%

对应材料：

- Demo 脚本：`docs/demo-script.md`
- 使用指南：`docs/user-guide.md`
- 架构说明：`docs/architecture.md`
- 提交检查清单：`docs/submission-checklist.md`

推荐演示亮点：

1. 填入示例内容，展示四平台自动适配。
2. 添加自定义平台，证明扩展能力。
3. 展示 AI 提示词包和标题备选。
4. 展示发布准备度看板。
5. 设置计划时间并模拟发布。
6. 展示发布日志和导出工作区。
