import { Router } from "express";
import {
  deleteCredentials,
  getCredentials,
  listCredentialSummaries,
  saveCredentials,
  getCredentialStorePath,
  summarizeCredentials
} from "../storage/credentials-store.js";

const router = Router();

router.get("/", (req, res) => {
  const summaries = listCredentialSummaries();
  const platforms = new Map(summaries.map((item) => [item.platform, item]));

  if (!platforms.has("wechat")) {
    platforms.set("wechat", summarizeCredentials("wechat", null));
  }
  if (!platforms.has("bilibili")) {
    platforms.set("bilibili", {
      platform: "bilibili",
      displayName: "Bilibili",
      connected: false,
      updatedAt: "",
      detail: {
        appId: "",
        hasSecret: false,
        author: "",
        hasThumbMediaId: false,
        browserProfile: ""
      }
    });
  }

  res.json([...platforms.values()]);
});

router.get("/store", (req, res) => {
  res.json({
    ok: true,
    path: getCredentialStorePath()
  });
});

router.get("/:platform", (req, res) => {
  res.json(summarizeCredentials(req.params.platform));
});

router.put("/wechat", (req, res) => {
  const { appId, appSecret, author = "", thumbMediaId = "" } = req.body || {};

  if (!appId || !appSecret) {
    res.status(400).json({ ok: false, code: "MISSING_WECHAT_CREDENTIALS", error: "AppID and AppSecret are required." });
    return;
  }

  const saved = saveCredentials("wechat", {
    displayName: "WeChat Official Account",
    appId: String(appId).trim(),
    appSecret: String(appSecret).trim(),
    author: String(author).trim(),
    thumbMediaId: String(thumbMediaId).trim()
  });

  res.json({ ok: true, credential: summarizeCredentials("wechat", saved) });
});

router.delete("/wechat", (req, res) => {
  deleteCredentials("wechat");
  res.json({ ok: true });
});

router.get("/wechat/status", (req, res) => {
  const credentials = getCredentials("wechat");
  res.json({
    platform: "wechat",
    connected: Boolean(credentials?.appId && credentials?.appSecret)
  });
});

export default router;
