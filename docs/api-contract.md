# API 契约草案

当前版本采用前端模拟发布。后续接入真实后端时，建议保持以下契约。

## 1. 创建发布任务

`POST /api/publish-jobs`

请求：

```json
{
  "source": {
    "title": "AI 工具如何提升多平台内容发布效率",
    "body": "正文内容",
    "tags": ["AI工具", "内容创作"],
    "coverUrl": "https://example.com/cover.png",
    "audience": "内容创作者",
    "voice": "专业、清晰",
    "cta": "欢迎收藏"
  },
  "targets": [
    {
      "platform": "wechat",
      "title": "标题",
      "body": "适配正文",
      "tags": ["AI工具"],
      "scheduleAt": "2026-05-30T10:00:00+08:00"
    }
  ]
}
```

响应：

```json
{
  "jobId": "job_20260530_001",
  "status": "queued",
  "targets": [
    {
      "platform": "wechat",
      "status": "queued"
    }
  ]
}
```

## 2. 查询发布任务

`GET /api/publish-jobs/:jobId`

响应：

```json
{
  "jobId": "job_20260530_001",
  "status": "running",
  "targets": [
    {
      "platform": "wechat",
      "status": "success",
      "remoteUrl": "https://example.com/post/1",
      "publishedAt": "2026-05-30T10:00:00+08:00"
    },
    {
      "platform": "rednote",
      "status": "failed",
      "reason": "封面图缺失"
    }
  ]
}
```

## 3. 平台授权状态

`GET /api/platform-auth`

响应：

```json
{
  "wechat": {
    "connected": true,
    "accountName": "示例公众号",
    "expiresAt": "2026-06-30T00:00:00+08:00"
  },
  "zhihu": {
    "connected": false,
    "accountName": "",
    "expiresAt": ""
  }
}
```

## 4. 错误码

- `VALIDATION_ERROR`：内容未通过本地或服务端校验。
- `AUTH_REQUIRED`：平台账号未授权。
- `TOKEN_EXPIRED`：授权过期。
- `PLATFORM_RATE_LIMITED`：平台接口限流。
- `PLATFORM_REJECTED`：平台拒绝发布。
- `UNKNOWN_ERROR`：未知错误。

## 5. 设计原则

- 前端适配结果仍可作为发布任务输入。
- 后端必须重新校验标题、正文、标签和封面。
- 平台返回的错误要保留原始信息，方便用户修复。
- 发布任务需要可重试，但不能重复发布同一平台内容。

