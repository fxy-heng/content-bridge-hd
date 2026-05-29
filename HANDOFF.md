# ContentBridge 交付快照

## 当前状态

项目目录：

```text
F:\研1\vibe实践\content-bridge
```

本地预览：

```text
http://localhost:5173
```

## 已完成核心能力

- 原始内容编辑：标题、正文、标签、封面、目标受众、品牌语气、行动引导。
- 内容模板：工具评测、教程指南、案例复盘。
- 多平台适配：公众号、知乎、B站、小红书。
- 自定义平台：页面内新增平台并参与适配。
- 平台校验：标题长度、标签数量、正文长度、封面提示。
- 标题备选：每个平台生成多个标题。
- AI 提示词包：每个平台生成可复制提示词。
- 发布准备度看板：可发布、需优化、阻塞。
- 发布策略建议：推荐主平台和优化顺序。
- 一键模拟发布：支持成功、失败、排期状态。
- 发布日志：本地保存最近发布记录。
- 工作区导入导出：JSON 保存和恢复。
- Markdown 导出：每个平台独立导出。
- 日历导出：将计划发布时间导出为 `.ics`。
- PWA/离线缓存：支持安装入口和核心资源缓存。

## 验证命令

```bash
npm run check
npm test
npm run smoke
```

均已通过。

## Git 提交概览

```text
dde6543 docs: add publish api contract and workspace sample
bde40b7 chore: add ci smoke checks and contributor docs
4a60c8b docs: explain templates and strategy guidance
cbc5ce5 feat: add templates and publishing strategy
f16b41c docs: map project to review criteria
79735d0 feat: add publishing readiness dashboard
f296627 docs: document custom platform workflow
98ce2ea feat: add custom platforms and ai prompt packs
1d2fd59 docs: update local commit summary
7440721 chore: use project npm cache
846d4f6 docs: add pull request records and github setup
3cc52dd docs: add architecture and demo materials
1ddfa02 feat: enhance publishing workspace workflow
fcabeb7 feat: scaffold content bridge mvp
```

## 推送到 GitHub

本机未检测到 `gh`，需要先在 GitHub 网页创建空仓库 `content-bridge`。

然后在项目目录执行：

```bash
git remote add origin https://github.com/fxy-heng/content-bridge.git
git push -u origin main
```

如果 remote 已存在：

```bash
git remote set-url origin https://github.com/fxy-heng/content-bridge.git
git push -u origin main
```

## Demo 录制顺序

1. 打开工作台。
2. 切换内容模板。
3. 展示四个平台自动适配。
4. 添加自定义平台“抖音”。
5. 展示 AI 提示词和标题备选。
6. 展示发布准备度和策略建议。
7. 设置未来发布时间并模拟发布。
8. 展示发布日志、导出 JSON、架构文档。
