# 架构设计

## 1. 总体思路

ContentBridge 将多平台发布拆成三层：

1. 内容输入层：维护统一的原始内容模型，包括标题、正文、标签、封面和计划发布时间。
2. 平台适配层：每个平台实现独立适配器，负责标题、正文结构、标签和校验规则。
3. 发布执行层：通过统一发布器接口执行模拟发布，后续可替换为真实平台 API。

当前版本是无后端静态应用，核心逻辑集中在 `src/core`，便于后续迁移到 Node.js 服务或前端框架。

## 2. 数据模型

```ts
type SourceContent = {
  title: string;
  body: string;
  tags: string[] | string;
  coverUrl?: string;
  scheduleAt?: string;
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
```

## 3. 平台适配器

平台差异通过 `platformMeta` 和 `adapters` 注册。

- `platformMeta` 描述平台名称、标题限制、标签限制、正文建议长度和发布类型。
- `adapters[platform]` 负责把统一内容转换为平台版本。
- `validateAdaptedContent` 统一生成错误和警告。

新增平台时的步骤：

1. 在 `platformOrder` 中加入平台 key。
2. 在 `platformMeta` 中增加限制和展示信息。
3. 在 `adapters` 中实现平台改写规则。
4. 为新平台补充单元测试。
5. 更新 README 中的支持平台说明。

## 4. 模拟发布器

`publishToPlatforms` 接收适配后的内容数组并返回发布结果：

- `success`：内容通过校验且没有设置未来排期。
- `scheduled`：设置了未来计划发布时间。
- `failed`：标题或正文为空等错误阻止发布。

真实发布接入方案：

1. 将 `Publisher` 抽象成接口。
2. 每个平台实现 OAuth 授权和 token 管理。
3. 发布前沿用当前校验器。
4. 将发布结果写入服务端数据库。
5. 失败时保留平台返回码、错误信息和重试状态。

## 5. 当前工程边界

当前版本不接入真实平台账号，原因是公众号、知乎、B站、小红书的开放接口权限、审核和 OAuth 流程差异较大。竞赛演示优先保证核心工作流完整：

输入内容 -> 自动适配 -> 平台校验 -> 预览复制 -> 模拟发布/排期 -> 发布日志。

## 6. 可演进方向

- 前端迁移到 React + TypeScript。
- 后端提供账号授权、发布队列和数据库。
- 接入大模型 API 生成更自然的平台改写版本。
- 支持团队协作、审核流和定时任务。
- 增加更多平台，例如抖音、快手、微博、今日头条。

