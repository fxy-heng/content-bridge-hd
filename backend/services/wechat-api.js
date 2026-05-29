const WECHAT_API = "https://api.weixin.qq.com";
const tokenCache = new Map();

export async function getAccessToken(appId, appSecret) {
  const cacheKey = appId;
  const cached = tokenCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const url = `${WECHAT_API}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || data.errcode) {
    throw new Error(formatWechatError("access_token request failed", data));
  }

  tokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 7200) * 1000
  });

  return data.access_token;
}

export async function verifyCredentials(appId, appSecret) {
  const token = await getAccessToken(appId, appSecret);
  return {
    ok: true,
    platform: "wechat",
    tokenPrefix: `${token.slice(0, 8)}...`
  };
}

export async function uploadImage(appId, appSecret, imageUrl) {
  if (!/^https?:\/\//i.test(imageUrl)) {
    throw new Error("Cover image must be a public HTTP or HTTPS URL.");
  }

  const token = await getAccessToken(appId, appSecret);
  const imageResponse = await fetch(imageUrl);

  if (!imageResponse.ok) {
    throw new Error(`Cover image download failed: HTTP ${imageResponse.status}.`);
  }

  const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Cover URL must return an image content type, got ${contentType}.`);
  }

  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  const extension = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const boundary = `----ContentBridge${Date.now()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="cover.${extension}"\r\nContent-Type: ${contentType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  const url = `${WECHAT_API}/cgi-bin/material/add_material?access_token=${encodeURIComponent(token)}&type=image`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length)
    },
    body
  });
  const data = await response.json();

  if (!response.ok || data.errcode) {
    throw new Error(formatWechatError("cover upload failed", data));
  }

  return {
    mediaId: data.media_id,
    url: data.url
  };
}

export async function createDraft(appId, appSecret, article) {
  const token = await getAccessToken(appId, appSecret);
  const payload = {
    articles: [{
      article_type: "news",
      title: normalizeText(article.title).slice(0, 32),
      author: normalizeText(article.author).slice(0, 8),
      digest: normalizeText(article.summary || article.title).slice(0, 120),
      content: markdownToWechatHtml(article.body || ""),
      content_source_url: "",
      thumb_media_id: article.thumbMediaId,
      need_open_comment: 1,
      only_fans_can_comment: 0
    }]
  };

  const url = `${WECHAT_API}/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();

  if (!response.ok || data.errcode) {
    throw new Error(formatWechatError("draft creation failed", data));
  }

  return data.media_id;
}

export async function publishDraft(appId, appSecret, mediaId) {
  const token = await getAccessToken(appId, appSecret);
  const url = `${WECHAT_API}/cgi-bin/freepublish/submit?access_token=${encodeURIComponent(token)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_id: mediaId })
  });
  const data = await response.json();

  if (!response.ok || data.errcode) {
    throw new Error(formatWechatError("publish submit failed", data));
  }

  return {
    publishId: String(data.publish_id || ""),
    msgId: data.msg_data_id ? String(data.msg_data_id) : ""
  };
}

export async function getPublishStatus(appId, appSecret, publishId) {
  const token = await getAccessToken(appId, appSecret);
  const url = `${WECHAT_API}/cgi-bin/freepublish/get?access_token=${encodeURIComponent(token)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publish_id: publishId })
  });
  const data = await response.json();

  if (!response.ok || data.errcode) {
    throw new Error(formatWechatError("publish status request failed", data));
  }

  return data;
}

export function markdownToWechatHtml(markdown) {
  const blocks = String(markdown)
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block) => {
    if (/^###\s+/.test(block)) {
      return `<h3 style="font-size:18px;font-weight:700;margin:20px 0 10px;">${inlineMarkdown(block.replace(/^###\s+/, ""))}</h3>`;
    }
    if (/^##\s+/.test(block)) {
      return `<h2 style="font-size:20px;font-weight:700;margin:24px 0 12px;">${inlineMarkdown(block.replace(/^##\s+/, ""))}</h2>`;
    }
    if (/^#\s+/.test(block)) {
      return `<h1 style="font-size:22px;font-weight:700;margin:28px 0 14px;">${inlineMarkdown(block.replace(/^#\s+/, ""))}</h1>`;
    }
    if (/^(-|\*)\s+/m.test(block)) {
      const items = block
        .split("\n")
        .map((line) => line.replace(/^(-|\*)\s+/, "").trim())
        .filter(Boolean)
        .map((line) => `<li>${inlineMarkdown(line)}</li>`)
        .join("");
      return `<ul style="padding-left:20px;margin:12px 0;line-height:1.8;">${items}</ul>`;
    }
    if (/^\d+\.\s+/m.test(block)) {
      const items = block
        .split("\n")
        .map((line) => line.replace(/^\d+\.\s+/, "").trim())
        .filter(Boolean)
        .map((line) => `<li>${inlineMarkdown(line)}</li>`)
        .join("");
      return `<ol style="padding-left:20px;margin:12px 0;line-height:1.8;">${items}</ol>`;
    }
    return `<p style="font-size:16px;line-height:1.8;margin:12px 0;">${inlineMarkdown(block).replace(/\n/g, "<br />")}</p>`;
  }).join("\n");
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatWechatError(prefix, data = {}) {
  const code = data.errcode ?? "unknown";
  const message = data.errmsg || JSON.stringify(data);
  return `WeChat ${prefix}: [${code}] ${message}`;
}
