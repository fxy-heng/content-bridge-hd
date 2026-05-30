import { deflateSync } from "node:zlib";

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
  return uploadImageBuffer(appId, appSecret, buffer, contentType, `cover.${extension}`);
}

export async function uploadGeneratedCover(appId, appSecret, title = "") {
  const buffer = createDefaultCoverPng(title);
  return uploadImageBuffer(appId, appSecret, buffer, "image/png", "contentbridge-cover.png");
}

async function uploadImageBuffer(appId, appSecret, buffer, contentType, filename) {
  const token = await getAccessToken(appId, appSecret);
  const boundary = `----ContentBridge${Date.now()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
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
    throw new WechatApiError(formatWechatError("publish submit failed", data), data.errcode, data);
  }

  return {
    publishId: String(data.publish_id || ""),
    msgId: data.msg_data_id ? String(data.msg_data_id) : ""
  };
}

export class WechatApiError extends Error {
  constructor(message, code, response) {
    super(message);
    this.name = "WechatApiError";
    this.code = code;
    this.response = response;
  }
}

export async function getDraftSwitchStatus(appId, appSecret) {
  const token = await getAccessToken(appId, appSecret);
  const url = `${WECHAT_API}/cgi-bin/draft/switch?access_token=${encodeURIComponent(token)}&checkonly=1`;
  const response = await fetch(url, { method: "POST" });
  const data = await response.json();

  if (!response.ok || data.errcode) {
    throw new WechatApiError(formatWechatError("draft switch status request failed", data), data.errcode, data);
  }

  return {
    isOpen: Number(data.is_open) === 1,
    raw: data
  };
}

export async function openDraftSwitch(appId, appSecret) {
  const token = await getAccessToken(appId, appSecret);
  const url = `${WECHAT_API}/cgi-bin/draft/switch?access_token=${encodeURIComponent(token)}`;
  const response = await fetch(url, { method: "POST" });
  const data = await response.json();

  if (!response.ok || data.errcode) {
    throw new WechatApiError(formatWechatError("draft switch open request failed", data), data.errcode, data);
  }

  return {
    isOpen: true,
    raw: data
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

function createDefaultCoverPng(title) {
  const width = 900;
  const height = 500;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const titleHash = hashText(title);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * 3;
      const gradient = Math.round((x / width) * 42 + (y / height) * 24);
      raw[offset] = 31 + ((titleHash + gradient) % 36);
      raw[offset + 1] = 95 + ((titleHash + gradient) % 42);
      raw[offset + 2] = 104 + ((titleHash + gradient) % 46);
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", Buffer.concat([
      uint32(width),
      uint32(height),
      Buffer.from([8, 2, 0, 0, 0])
    ])),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const crcInput = Buffer.concat([typeBuffer, data]);
  return Buffer.concat([
    uint32(data.length),
    typeBuffer,
    data,
    uint32(crc32(crcInput))
  ]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function hashText(value) {
  return [...String(value || "ContentBridge")].reduce((hash, char) => {
    return (hash + char.charCodeAt(0)) % 97;
  }, 0);
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function formatWechatError(prefix, data = {}) {
  const code = data.errcode ?? "unknown";
  const message = data.errmsg || JSON.stringify(data);
  return `WeChat ${prefix}: [${code}] ${message}${wechatHint(code, prefix)}`;
}

function wechatHint(code, prefix) {
  if (String(code) !== "48001") {
    return "";
  }
  if (prefix.includes("cover upload")) {
    return "。处理建议：当前账号没有公众号“素材管理/新增永久素材”接口权限。请确认填写的是公众号 AppID/AppSecret，不是小程序 AppID/AppSecret；小程序后台里的 wx.* 接口权限不能用于发布公众号图文。公众号发布需要登录公众号后台检查 设置与开发 -> 接口权限，并通常需要已认证公众号开通素材管理、草稿箱/发布相关接口。";
  }
  if (prefix.includes("draft")) {
    return "。处理建议：当前公众号没有“草稿箱”接口权限。请在微信公众平台检查 设置与开发 -> 接口权限，确认账号类型和认证状态支持草稿接口。";
  }
  if (prefix.includes("publish")) {
    return "。处理建议：当前公众号没有“发布”接口权限。请检查公众号认证状态和接口权限。";
  }
  return "。处理建议：当前公众号未获得该微信 API 权限，请在微信公众平台的接口权限页面确认。";
}
