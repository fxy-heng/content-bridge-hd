# API 契约

当前版本已经包含真实发布后端。前端仍保留静态模拟发布能力；当 `GET /api/health` 可用且对应平台账号已连接时，`src/core/publisher.js` 会切换到真实发布路径。

## 1. 健康检查

`GET /api/health`

```json
{
  "ok": true,
  "name": "ContentBridge backend",
  "version": "0.2.0",
  "realPublish": ["wechat", "bilibili"]
}
```

## 2. 凭证状态

`GET /api/credentials`

返回值只包含脱敏信息，后端不会把 `AppSecret` 返回给前端。

```json
[
  {
    "platform": "wechat",
    "displayName": "WeChat Official Account",
    "connected": true,
    "updatedAt": "2026-05-29T10:00:00.000Z",
    "detail": {
      "appId": "wx1234****",
      "hasSecret": true,
      "author": "ContentBridge",
      "hasThumbMediaId": false,
      "browserProfile": ""
    }
  }
]
```

## 3. 公众号凭证

`POST /api/wechat/verify`

```json
{
  "appId": "wx...",
  "appSecret": "..."
}
```

`PUT /api/credentials/wechat`

```json
{
  "appId": "wx...",
  "appSecret": "...",
  "author": "ContentBridge",
  "thumbMediaId": "optional_permanent_media_id"
}
```

## 4. 公众号真实发布

`POST /api/wechat/publish`

```json
{
  "title": "标题",
  "body": "# Markdown 正文",
  "summary": "摘要",
  "tags": ["AI", "效率"],
  "coverUrl": "https://example.com/cover.jpg"
}
```

成功：

```json
{
  "status": "success",
  "platform": "wechat",
  "mode": "real",
  "mediaId": "MEDIA_ID",
  "publishId": "PUBLISH_ID",
  "msgId": "",
  "publishedAt": "2026-05-29T10:00:00.000Z"
}
```

约束：

- 需要认证公众号、有效 `AppID` / `AppSecret`、服务器 IP 白名单。
- 微信草稿接口需要封面素材。可提供公开图片 URL，后端会上传为永久素材；也可提前保存 `thumb_media_id`。
- 标题会按微信接口限制截断到 32 个字符。
- 提交发布使用微信 `freepublish_submit` 接口，要求公众号获得对应发布接口权限（权限集 7）。若账号可创建草稿但没有该发布权限，接口会返回 `draft_ready`，表示草稿已进入公众号后台草稿箱，但最终发布需在公众号后台完成。

## 5. B 站浏览器登录与发布

`POST /api/bilibili/login`

打开本机浏览器登录页，扫码后登录态保存到 `backend/data/bilibili-profile`。

`GET /api/bilibili/status`

检测当前浏览器资料目录是否仍处于登录状态。

`POST /api/bilibili/publish`

```json
{
  "title": "标题",
  "body": "正文",
  "tags": ["AI", "效率"],
  "coverUrl": ""
}
```

B 站没有稳定的专栏发布开放 API，因此后端通过 Puppeteer 打开创作中心、填写标题和正文并点击发布按钮。若登录失效或页面结构变化，接口会返回 `login_required`、`manual_required` 或 `failed`，不会伪造成功。

## 6. 错误码

- `MISSING_WECHAT_CREDENTIALS`：公众号凭证未配置。
- `MISSING_WECHAT_COVER`：公众号发布缺少封面素材。
- `EMPTY_CONTENT`：标题或正文为空。
- `login_required`：B 站需要扫码登录。
- `manual_required`：内容已填写，但自动化无法安全点击发布按钮。
- `PLATFORM_REJECTED`：平台接口拒绝请求，原始错误会保留在 `reason` 或 `error` 中。
