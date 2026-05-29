import { addRoute, sendJson } from "../server.js";
import {
  getAccessToken,
  uploadImage,
  createDraft,
  publishDraft,
  verifyCredentials
} from "../services/wechat-api.js";
import { getCredentials } from "../storage/credentials-store.js";

addRoute("POST", "/api/wechat/verify", async (req, res) => {
  const { appId, appSecret } = req.body;

  if (!appId || !appSecret) {
    sendJson(res, { ok: false, error: "请提供 AppID 和 AppSecret" }, 400);
    return;
  }

  try {
    const result = await verifyCredentials(appId, appSecret);
    sendJson(res, result);
  } catch (err) {
    sendJson(res, { ok: false, error: err.message }, 401);
  }
});

addRoute("POST", "/api/wechat/publish", async (req, res) => {
  const { title, body, summary, tags, coverUrl } = req.body;
  const creds = getCredentials("wechat");

  if (!creds || !creds.appId || !creds.appSecret) {
    sendJson(res, {
      status: "failed",
      reason: "未配置公众号凭证，请在账号设置中配置 AppID 和 AppSecret"
    }, 400);
    return;
  }

  try {
    // Step 1: Upload cover image if provided
    let thumbMediaId = "";
    if (coverUrl) {
      try {
        const result = await uploadImage(creds.appId, creds.appSecret, coverUrl);
        thumbMediaId = result.mediaId;
      } catch (err) {
        // Cover image failure is non-fatal — continue without it
        console.warn("Cover upload failed:", err.message);
      }
    }

    // Step 2: Convert body to HTML if it's markdown
    const article = {
      title: title || "未命名内容",
      body: body || "",
      summary: summary || "",
      author: creds.author || "",
      thumbMediaId,
      sourceUrl: ""
    };

    // Step 3: Create draft
    const mediaId = await createDraft(creds.appId, creds.appSecret, article);

    // Step 4: Publish the draft
    const publishResult = await publishDraft(creds.appId, creds.appSecret, mediaId);

    sendJson(res, {
      status: "success",
      platform: "wechat",
      mediaId,
      publishId: publishResult.publishId,
      msgId: publishResult.msgId,
      publishedAt: new Date().toISOString()
    });
  } catch (err) {
    sendJson(res, {
      status: "failed",
      platform: "wechat",
      reason: err.message
    }, 500);
  }
});

addRoute("GET", "/api/wechat/status", (req, res) => {
  const creds = getCredentials("wechat");
  sendJson(res, {
    platform: "wechat",
    connected: Boolean(creds && creds.appId && creds.appSecret),
    maskAppId: creds ? creds.appId.slice(0, 6) + "****" : ""
  });
});
