const WECHAT_API = "https://api.weixin.qq.com";

const tokenCache = new Map();

export async function getAccessToken(appId, appSecret) {
  const cacheKey = `${appId}`;
  const cached = tokenCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now() + 60000) {
    return cached.token;
  }

  const url = `${WECHAT_API}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.errcode) {
    throw new Error(`微信 access_token 获取失败: [${data.errcode}] ${data.errmsg}`);
  }

  tokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000
  });

  return data.access_token;
}

export async function uploadImage(appId, appSecret, imageUrl) {
  const token = await getAccessToken(appId, appSecret);

  // If it's a URL, fetch the image first
  let buffer;
  let contentType;
  let filename;

  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    try {
      const imageResponse = await fetch(imageUrl);
      buffer = Buffer.from(await imageResponse.arrayBuffer());
      contentType = imageResponse.headers.get("content-type") || "image/png";
      const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
      filename = `cover.${ext}`;
    } catch {
      throw new Error("封面图下载失败，请检查图片地址是否可访问");
    }
  } else {
    // Local path — read file
    throw new Error("暂不支持本地文件路径上传，请提供可访问的图片 URL");
  }

  const boundary = `----FormBoundary${Date.now()}`;
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
  if (data.errcode) {
    throw new Error(`微信图片上传失败: [${data.errcode}] ${data.errmsg}`);
  }

  return { mediaId: data.media_id, url: data.url };
}

export async function createDraft(appId, appSecret, article) {
  const token = await getAccessToken(appId, appSecret);

  const payload = {
    articles: [{
      article_type: "news",
      title: article.title.slice(0, 32),
      author: article.author || "",
      digest: article.summary ? article.summary.slice(0, 128) : article.title.slice(0, 54),
      content: typeof article.content === "string" ? article.content : markdownToWechatHtml(article.body || ""),
      content_source_url: article.sourceUrl || "",
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
  if (data.errcode) {
    throw new Error(`微信草稿创建失败: [${data.errcode}] ${data.errmsg}`);
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
  if (data.errcode) {
    // publish_msg_id 带 errcode=0 是成功
    if (data.publish_id) {
      return { publishId: String(data.publish_id), msgId: data.msg_data_id ? String(data.msg_data_id) : "" };
    }
    throw new Error(`微信发布失败: [${data.errcode}] ${data.errmsg}`);
  }

  return { publishId: String(data.publish_id || ""), msgId: data.msg_data_id ? String(data.msg_data_id) : "" };
}

export async function verifyCredentials(appId, appSecret) {
  const token = await getAccessToken(appId, appSecret);
  return { ok: true, tokenPrefix: token.slice(0, 8) + "..." };
}

function markdownToWechatHtml(md) {
  let html = String(md);
  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3 style="font-size:18px;font-weight:700;margin:20px 0 10px;">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="font-size:20px;font-weight:700;margin:24px 0 12px;">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 style="font-size:22px;font-weight:700;margin:28px 0 14px;">$1</h1>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul style="padding-left:20px;margin:10px 0;">${match}</ul>`);
  // Numbered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  // Paragraphs — wrap non-tag lines in <p>
  html = html
    .split("\n\n")
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("<")) return trimmed;
      return `<p style="line-height:1.8;margin:10px 0;">${trimmed}</p>`;
    })
    .join("\n");

  return html;
}

// Expose for route use
export { markdownToWechatHtml };
