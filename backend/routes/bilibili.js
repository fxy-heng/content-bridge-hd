import { addRoute, sendJson } from "../server.js";
import { publishArticle, checkLoginStatus } from "../services/bilibili-browser.js";

addRoute("POST", "/api/bilibili/publish", async (req, res) => {
  const { title, body, tags, coverUrl } = req.body;

  if (!title || !body) {
    sendJson(res, {
      status: "failed",
      reason: "标题和正文不能为空"
    }, 400);
    return;
  }

  try {
    const result = await publishArticle({ title, body, tags, coverUrl });
    sendJson(res, result);
  } catch (err) {
    sendJson(res, {
      status: "failed",
      platform: "bilibili",
      reason: err.message
    }, 500);
  }
});

addRoute("GET", "/api/bilibili/status", async (req, res) => {
  try {
    const status = await checkLoginStatus();
    sendJson(res, {
      platform: "bilibili",
      connected: status.loggedIn,
      ...status
    });
  } catch (err) {
    sendJson(res, {
      platform: "bilibili",
      connected: false,
      error: err.message
    });
  }
});
