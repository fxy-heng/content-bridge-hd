# 架构设计

## 1. 总体思路

ContentBridge 将多平台发布拆成四层：

1. 内容输入层：维护统一的原始内容模型，包括标题、正文、标签、封面、目标受众、语气和计划发布时间。
2. 平台适配层：每个平台实现独立适配器，负责标题、正文结构、标签和校验规则。
3. 发布执行层：`publishToPlatforms` 统一判断本地模拟、排期、校验失败和真实后端发布。
4. 真实发布后端：Express 提供账号凭证、公众号 API 发布、B 站浏览器登录和自动化发布。

纯前端模式仍然可运行；后端模式启动后，前端会调用 `/api/health` 和 `/api/credentials` 判断是否可以走真实平台发布。

## 2. 核心数据模型

```ts
type SourceContent = {
  title: string;
  body: string;
  tags: string[] | string;
  coverUrl?: string;
  scheduleAt?: string;
  audience?: string;
  voice?: string;
  cta?: string;
};

type AdaptedContent = {
  platform: "wechat" | "zhihu" | "bilibili" | "rednote";
  displayName: string;
  title: string;
  body: string;
  tags: string[];
  coverUrl?: string;
  tone: string;
  publishMode: string;
  validation: ValidationResult;
};

type PublishResult = {
  platform: string;
  status: "success" | "scheduled" | "failed";
  mode: "simulated" | "real";
  reason?: string;
  detail?: unknown;
};
```

## 3. 平台适配器

平台差异通过 `platformMeta`、内置适配器和自定义平台注册表管理。

- `platformMeta` 描述平台名称、标题限制、标签限制、正文建议长度和发布类型。
- `builtInAdapters[platform]` 将统一内容改写为平台版本。
- `getPlatformRegistry(customPlatforms)` 合并内置平台和用户自定义平台。
- `validateAdaptedContent` 统一生成错误和警告。
- 自定义平台使用 `adaptGenericPlatform`，并继承导出、校验和模拟发布流程。

新增平台时，只需要添加平台元信息、适配器、测试和 README 说明；若只是演示扩展能力，也可以直接在 UI 的“扩展更多平台”面板中添加。

## 4. 发布器策略

`src/core/publisher.js` 的决策顺序：

1. 内容校验失败：返回 `failed`。
2. 设置未来发布时间：返回 `scheduled`，不触发真实发布。
3. 后端不可用：返回 `simulated` 成功结果。
4. 后端可用但平台未连接：返回 `simulated` 成功结果。
5. 后端可用且平台已连接：调用真实后端；成功标记 `mode: "real"`，平台拒绝时标记 `failed` 并保留原因。

这保证了演示模式稳定，同时不会把真实发布失败伪装成成功。

## 5. 真实发布后端

后端位于 `backend/`：

- `server.js`：Express 入口，挂载 API 路由并托管前端静态文件。
- `routes/credentials.js`：凭证保存、删除和脱敏状态查询。
- `routes/wechat.js`：公众号凭证验证、发布、发布状态查询。
- `routes/bilibili.js`：B 站打开登录页、检测登录态、发布。
- `services/wechat-api.js`：微信 access_token、封面上传、草稿创建、发布提交、Markdown 转 HTML。
- `services/bilibili-browser.js`：Puppeteer 浏览器资料目录、扫码登录、创作中心填写和提交。
- `storage/credentials-store.js`：本地 JSON 凭证存储，`backend/data/` 被 `.gitignore` 忽略。

## 6. 平台边界

公众号使用官方 API，因此需要认证公众号、IP 白名单、有效 `AppID` / `AppSecret`，并且文章必须有封面素材。

B 站专栏没有稳定公开发布 API，因此采用浏览器自动化。该能力依赖创作中心页面结构，若选择器失效，后端会返回 `manual_required`，让用户在已填写好的浏览器页面中手动确认。

知乎和小红书当前保留为适配与模拟发布。它们的真实发布可沿用 `bilibili-browser.js` 的浏览器资料目录方案扩展，但需要针对各自创作中心单独维护登录、编辑器和提交按钮选择器。

## 7. 可演进方向

- 为真实发布增加任务队列、重试和发布状态轮询。
- 将凭证存储从本地 JSON 升级为加密存储。
- 为知乎、小红书增加浏览器自动化适配器。
- 接入模型 API，根据平台规则生成更自然的改写版本。
- 增加团队协作、审核流和定时任务。
