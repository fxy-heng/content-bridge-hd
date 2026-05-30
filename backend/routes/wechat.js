import { Router } from "express";
import { getCredentials } from "../storage/credentials-store.js";
import {
  createDraft,
  getAccessToken,
  getDraftSwitchStatus,
  getPublishStatus,
  openDraftSwitch,
  publishDraft,
  uploadGeneratedCover,
  uploadImage,
  verifyCredentials,
  WechatApiError
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

    let publishResult = null;
    try {
      publishResult = await publishDraft(credentials.appId, credentials.appSecret, mediaId);
    } catch (error) {
      if (error instanceof WechatApiError && String(error.code) === "48001") {
        res.json({
          status: "draft_ready",
          platform: "wechat",
          mode: "real",
          mediaId,
          reason: "公众号草稿已创建成功，但当前账号没有微信 freepublish 发布接口权限。请到公众号后台草稿箱手动发布。",
          publishedAt: new Date().toISOString()
        });
        return;
      }
      throw error;
    }

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

router.get("/capabilities", async (req, res) => {
  const credentials = getCredentials("wechat");
  if (!credentials?.appId || !credentials?.appSecret) {
    res.status(400).json({
      ok: false,
      platform: "wechat",
      code: "MISSING_WECHAT_CREDENTIALS",
      checks: [{ name: "credentials", ok: false, message: "WeChat credentials are not configured." }]
    });
    return;
  }

  const checks = [];
  try {
    await getAccessToken(credentials.appId, credentials.appSecret);
    checks.push({ name: "access_token", ok: true, message: "AppID and AppSecret are valid." });
  } catch (error) {
    checks.push({ name: "access_token", ok: false, message: error.message });
    res.status(200).json({ ok: false, platform: "wechat", checks });
    return;
  }

  try {
    const cover = await uploadGeneratedCover(credentials.appId, credentials.appSecret, "ContentBridge capability test");
    checks.push({ name: "cover_material", ok: true, message: "Permanent image material upload is available.", mediaId: cover.mediaId });
  } catch (error) {
    checks.push({ name: "cover_material", ok: false, message: error.message });
  }

  res.json({
    ok: checks.every((item) => item.ok),
    platform: "wechat",
    checks
  });
});

router.get("/draft-switch", async (req, res, next) => {
  const credentials = getCredentials("wechat");
  if (!credentials?.appId || !credentials?.appSecret) {
    res.status(400).json({ ok: false, code: "MISSING_WECHAT_CREDENTIALS", error: "WeChat credentials are not configured." });
    return;
  }

  try {
    res.json({
      ok: true,
      platform: "wechat",
      ...(await getDraftSwitchStatus(credentials.appId, credentials.appSecret))
    });
  } catch (error) {
    error.status = 502;
    next(error);
  }
});

router.post("/draft-switch", async (req, res, next) => {
  const credentials = getCredentials("wechat");
  if (!credentials?.appId || !credentials?.appSecret) {
    res.status(400).json({ ok: false, code: "MISSING_WECHAT_CREDENTIALS", error: "WeChat credentials are not configured." });
    return;
  }

  try {
    res.json({
      ok: true,
      platform: "wechat",
      ...(await openDraftSwitch(credentials.appId, credentials.appSecret))
    });
  } catch (error) {
    error.status = 502;
    next(error);
  }
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
