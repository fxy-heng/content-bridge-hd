# ContentBridge 项目计划

## 1. 项目定位

项目名称暂定为 ContentBridge，面向公众号、知乎、B站、小红书等平台的内容创作者，解决同一份内容在不同平台发布时反复改格式、改标题、改标签、调整排版和检查发布要求的问题。

本项目的核心不是做一个完整替代各平台后台的商业级系统，而是在竞赛周期内做出一个可演示、可扩展、工程结构清晰的多平台内容发布工具：

- 用户输入一份原始内容。
- 系统根据目标平台自动生成适配版本。
- 用户可以预览不同平台的发布效果。
- 用户可以执行一键模拟发布，看到每个平台的发布状态、失败原因和发布记录。
- 系统提供新增平台适配器的架构设计，证明后续可扩展到更多平台。

## 2. 参考项目启发

参考项目：yikart/AiToEarn

可借鉴方向：

- 以 Publish 为核心能力，强调一键分发到多平台。
- 将平台差异抽象为统一的发布能力，而不是在业务代码里硬编码每个平台逻辑。
- README 中清晰列出支持平台、启动方式、依赖、演示入口。
- 用 Agent/AI 辅助内容生成和适配，但竞赛项目应控制范围，优先保证核心工作流稳定可演示。

本项目与参考项目的差异化：

- 聚焦“内容格式与风格适配”，而不是完整内容变现平台。
- 一键发布采用模拟发布或可插拔发布器，避免真实平台 API/OAuth 申请阻塞开发。
- 强调平台适配器架构、预览体验、发布流程可观测性，更适合竞赛演示。

## 3. 核心功能范围

### 3.1 MVP 必做功能

1. 内容编辑器
   - 支持输入标题、正文、标签、封面图地址或占位图。
   - 支持 Markdown 或纯文本输入。
   - 支持保存草稿到本地状态或后端存储。

2. 平台选择
   - 支持公众号、知乎、B站、小红书四个平台。
   - 每个平台展示格式限制，例如标题长度、正文风格、标签数量、摘要要求。

3. 自动适配
   - 公众号：偏长文结构，自动生成摘要、小标题、引导语。
   - 知乎：偏问答/观点表达，生成问题式标题、逻辑分段、结论段。
   - B站：生成视频简介风格文案、分 P/时间线占位、话题标签。
   - 小红书：生成种草风格标题、emoji 可选、短段落、话题标签。

4. 平台预览
   - 同屏或标签页查看每个平台的适配结果。
   - 显示平台限制检查结果，例如标题超长、标签过多、正文为空。

5. 一键模拟发布
   - 批量发布选中的平台。
   - 每个平台返回 success、failed、pending 等状态。
   - 展示发布日志，包括平台、发布时间、标题、状态、失败原因。

6. 可扩展平台架构
   - 用 PlatformAdapter 接口抽象平台适配逻辑。
   - 用 Publisher 接口抽象发布逻辑。
   - 新增平台时只需要新增 adapter 配置和发布实现，不改核心流程。

### 3.2 加分功能

1. AI 辅助适配
   - 提供 prompt 模板。
   - 本地先用规则引擎实现，后续可接入大模型接口。
   - README 明确说明 AI 接入方式和模拟模式。

2. 发布排期
   - 用户为不同平台设置计划发布时间。
   - 演示时可展示排期列表和状态流转。

3. 内容质量检查
   - 检查标题吸引力、标签覆盖、是否缺少封面、是否超出平台限制。
   - 给出可编辑建议。

4. 导出功能
   - 导出各平台文案为 Markdown/JSON。
   - 方便用户手动复制到平台后台。

## 4. 技术方案建议

建议使用前后端分离或轻量全栈结构：

- 前端：React + TypeScript + Vite
- UI：Tailwind CSS 或 shadcn/ui
- 后端：Node.js + Express/Fastify 或 Next.js API Routes
- 数据：开发期优先使用 SQLite 或 JSON 文件，后续可扩展数据库
- 测试：Vitest 单元测试，重点覆盖适配器和发布流程

推荐项目结构：

```text
content-bridge/
  frontend/
    src/
      components/
      pages/
      adapters-preview/
      services/
  backend/
    src/
      adapters/
      publishers/
      workflows/
      storage/
      routes/
      tests/
  docs/
    architecture.md
    demo-script.md
    pr-plan.md
  README.md
```

如果想降低开发成本，也可以先采用单体 Vite + 本地模拟 API，在代码结构上预留 backend 子目录，后续 PR 再拆出服务端。

## 5. 核心架构设计

### 5.1 内容模型

```ts
type SourceContent = {
  title: string;
  body: string;
  tags: string[];
  coverUrl?: string;
  authorNote?: string;
};
```

### 5.2 平台适配器

```ts
interface PlatformAdapter {
  platform: PlatformKey;
  displayName: string;
  limits: PlatformLimits;
  adapt(input: SourceContent): AdaptedContent;
  validate(content: AdaptedContent): ValidationResult;
}
```

### 5.3 发布器

```ts
interface Publisher {
  platform: PlatformKey;
  publish(content: AdaptedContent): Promise<PublishResult>;
}
```

### 5.4 扩展新平台步骤

1. 新增 `platforms/douyin.adapter.ts`。
2. 实现 `adapt` 和 `validate`。
3. 新增 `publishers/douyin.publisher.ts`，可以先模拟发布。
4. 在平台注册表中注册。
5. 增加对应单元测试和 README 说明。

## 6. 演示路径

演示视频建议按以下路径录制：

1. 介绍创作者多平台发布的痛点。
2. 输入一篇原始内容。
3. 勾选公众号、知乎、B站、小红书。
4. 点击自动适配，展示四个平台生成结果差异。
5. 修改某个平台的标题或标签，展示可编辑性。
6. 查看限制检查，例如标题长度、标签数量。
7. 点击一键模拟发布，展示发布状态和日志。
8. 打开架构说明页或 README，说明如何扩展更多平台。

## 7. 风险与规避

- 真实平台 API/OAuth 难以在竞赛周期内稳定接入：采用模拟发布作为主流程，预留真实发布接口。
- AI 接口可能受网络、Key、费用影响：规则引擎作为默认实现，AI 作为可选增强。
- 功能过多导致完成度下降：优先保证输入、适配、预览、校验、模拟发布五个闭环。
- 提交过程不合规：从第一天开始按 PR 拆分开发，README 持续记录依赖与原创部分。

