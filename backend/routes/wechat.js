import { Router } from "express";
import { getCredentials } from "../storage/credentials-store.js";
import {
  createDraft,
  getPublishStatus,
  publishDraft,
  uploadGeneratedCover,
  uploadImage,
  verifyCredentials
} from "../services/wechat-api.js";

const router = Router();

router.post("/verify", async (req, res, next) => {
  const { appId, appSecret } = req.body || {};

  if (!appId || !appSecret) {
    res.status(400).json({ ok: false, code: "MISSING_WECHAT_CREDENTIALS", error: "AppID and AppSecret are required." });
    return;
  }

  try {
    res.json(await verifyCredentials(String(appId).trim(), String(appSecret).trim()));
  } catch (error) {
    error.status = 401;
    next(error);
  }
});

router.post("/publish", async (req, res, next) => {
  const { title = "", body = "", summary = "", coverUrl = "" } = req.body || {};
  const credentials = getCredentials("wechat");

  if (!credentials?.appId || !credentials?.appSecret) {
    res.status(400).json({
      status: "failed",
      platform: "wechat",
      code: "MISSING_WECHAT_CREDENTIALS",
      reason: "WeChat credentials are not configured."
    });
    return;
  }

  if (!title.trim() || !body.trim()) {
    res.status(400).json({
      status: "failed",
      platform: "wechat",
      code: "EMPTY_CONTENT",
      reason: "Title and body are required."
    });
    return;
  }

  try {
    let thumbMediaId = credentials.thumbMediaId || "";
    if (coverUrl) {
      const uploaded = await uploadImage(credentials.appId, credentials.appSecret, coverUrl);
      thumbMediaId = uploaded.mediaId;
    }

    if (!thumbMediaId) {
      const generated = await uploadGeneratedCover(credentials.appId, credentials.appSecret, title);
      thumbMediaId = generated.mediaId;
    }

    const mediaId = await createDraft(credentials.appId, credentials.appSecret, {
      title,
      body,
      summary,
      author: credentials.author || "",
      thumbMediaId
    });

    const publishResult = await publishDraft(credentials.appId, credentials.appSecret, mediaId);
    res.json({
      status: "success",
      platform: "wechat",
      mode: "real",
      mediaId,
      publishId: publishResult.publishId,
      msgId: publishResult.msgId,
      publishedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(502).json({
      status: "failed",
      platform: "wechat",
      mode: "real",
      code: "WECHAT_API_ERROR",
      reason: error.message || "WeChat publish request failed."
    });
  }
});

router.get("/status", (req, res) => {
  const credentials = getCredentials("wechat");
  res.json({
    platform: "wechat",
    connected: Boolean(credentials?.appId && credentials?.appSecret),
    hasThumbMediaId: Boolean(credentials?.thumbMediaId),
    appId: credentials?.appId ? `${credentials.appId.slice(0, 6)}****` : ""
  });
});

router.get("/publish/:publishId", async (req, res, next) => {
  const credentials = getCredentials("wechat");
  if (!credentials?.appId || !credentials?.appSecret) {
    res.status(400).json({ ok: false, code: "MISSING_WECHAT_CREDENTIALS", error: "WeChat credentials are not configured." });
    return;
  }

  try {
    res.json(await getPublishStatus(credentials.appId, credentials.appSecret, req.params.publishId));
  } catch (error) {
    error.status = 502;
    next(error);
  }
});

export default router;
