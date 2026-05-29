import { createApp } from "../backend/server.js";

const server = createApp().listen(0);

try {
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const health = await fetchJson(`${baseUrl}/api/health`);
  assert(health.ok === true, "health endpoint should return ok");
  assert(Array.isArray(health.realPublish), "health endpoint should list real publish platforms");

  const credentials = await fetchJson(`${baseUrl}/api/credentials`);
  assert(Array.isArray(credentials), "credentials endpoint should return a list");
  assert(credentials.some((item) => item.platform === "wechat"), "credentials should include wechat summary");
  assert(credentials.some((item) => item.platform === "zhihu"), "credentials should include zhihu summary");
  assert(credentials.some((item) => item.platform === "bilibili"), "credentials should include bilibili summary");

  const missingWechat = await fetch(`${baseUrl}/api/wechat/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "", body: "" })
  });
  assert([400, 422, 502].includes(missingWechat.status), "wechat publish should reject invalid content or credentials");

  console.log("ok - backend smoke checks passed");
} finally {
  server.close();
}

async function fetchJson(url) {
  const response = await fetch(url);
  assert(response.ok, `${url} should return HTTP 2xx`);
  return response.json();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
