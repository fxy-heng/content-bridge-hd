# PR 记录草案

以下内容可在创建 GitHub PR 时直接复制。当前本地提交已经按相近粒度拆分。

## PR 01: 初始化项目与基础 MVP

### 标题

初始化多平台内容发布工具 MVP

### 功能描述

创建 ContentBridge 项目骨架，实现最小可运行工作流：输入原始内容、选择平台、生成四个平台的适配结果，并提供基础模拟发布日志。

### 实现思路

使用无第三方依赖的 HTML、CSS、JavaScript ES Modules 实现静态应用。核心逻辑放在 `src/core`，平台规则通过适配器函数隔离，方便后续迁移到 React 或后端服务。

### 测试方式

运行：

```bash
npm test
```

并在浏览器中打开页面，确认公众号、知乎、B站、小红书均能生成适配结果。

## PR 02: 增强发布工作台流程

### 标题

增强草稿、质量评分、排期和导出能力

### 功能描述

增加草稿本地保存、内容质量评分、未来时间排期、平台文案复制、Markdown 导出、JSON 导出和更完整的发布日志状态。

### 实现思路

在 `src/core/adapters.js` 中增加内容质量评分和更完整的平台元数据；在 `src/core/publisher.js` 中增加 `scheduled` 状态；前端通过 LocalStorage 保存草稿和日志。新增 `scripts/serve.js` 提供无依赖本地静态服务器。

### 测试方式

运行：

```bash
node --check src/core/adapters.js
node --check src/core/publisher.js
node --check src/app.js
node --check scripts/serve.js
npm test
```

浏览器访问 `http://localhost:5173`，验证示例内容、排期、复制、导出和模拟发布。

## PR 03: 补充架构和演示材料

### 标题

补充平台扩展架构、demo 脚本和提交检查清单

### 功能描述

完善 README、架构说明、demo 视频脚本和提交检查清单，方便评委理解项目设计和复现实验流程。

### 实现思路

在 `docs/architecture.md` 中说明内容模型、平台适配器、模拟发布器和真实发布扩展方案；在 `docs/demo-script.md` 中给出视频录制顺序；在 `docs/submission-checklist.md` 中整理最终提交前检查项。

### 测试方式

人工检查文档链接和 README 中的启动、测试命令是否准确。

