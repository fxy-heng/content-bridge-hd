import { addRoute, sendJson } from "../server.js";
import {
  getCredentials,
  saveCredentials,
  deleteCredentials,
  listCredentials
} from "../storage/credentials-store.js";

addRoute("GET", "/api/credentials", (req, res) => {
  const list = listCredentials();
  // Mask sensitive data
  const masked = list.map((item) => {
    const creds = getCredentials(item.platform);
    return {
      platform: item.platform,
      displayName: item.displayName,
      connected: item.hasCredentials,
      updatedAt: item.updatedAt,
      detail: {
        appId: creds?.appId ? creds.appId.slice(0, 6) + "****" : "",
        hasSecret: Boolean(creds?.appSecret),
        author: creds?.author || ""
      }
    };
  });
  sendJson(res, masked);
});

addRoute("PUT", "/api/credentials/wechat", (req, res) => {
  const { appId, appSecret, author } = req.body;

  if (!appId || !appSecret) {
    sendJson(res, { ok: false, error: "请提供 AppID 和 AppSecret" }, 400);
    return;
  }

  saveCredentials("wechat", {
    displayName: "公众号",
    appId,
    appSecret,
    author: author || ""
  });

  sendJson(res, { ok: true, platform: "wechat" });
});

addRoute("DELETE", "/api/credentials/wechat", (req, res) => {
  deleteCredentials("wechat");
  sendJson(res, { ok: true });
});

addRoute("GET", "/api/credentials/wechat/status", (req, res) => {
  const creds = getCredentials("wechat");
  sendJson(res, {
    platform: "wechat",
    connected: Boolean(creds && creds.appId && creds.appSecret)
  });
});
