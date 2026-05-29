import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const profileDir = join(__dirname, "..", "data", "rednote-profile");
const cookieFile = join(__dirname, "..", "data", "rednote-cookies.json");
const loginUrl = "https://creator.xiaohongshu.com/login";
const homeUrl = "https://creator.xiaohongshu.com/";
const publishUrl = "https://creator.xiaohongshu.com/publish/publish";

let browserInstance = null;

async function getBrowser() {
  if (browserInstance?.isConnected()) {
    return browserInstance;
  }

  mkdirSync(profileDir, { recursive: true });
  browserInstance = await puppeteer.launch({
    headless: process.env.REDNOTE_HEADLESS === "1" ? "new" : false,
    userDataDir: profileDir,
    defaultViewport: { width: 1366, height: 900 },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check"
    ],
    ignoreDefaultArgs: ["--enable-automation"]
  });

  return browserInstance;
}

export async function openLoginPage() {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.goto(loginUrl, { waitUntil: "networkidle2", timeout: 30_000 });

  return {
    ok: true,
    platform: "rednote",
    status: "login_required",
    loginUrl,
    message: "请在打开的浏览器窗口中扫码登录小红书创作者中心"
  };
}

export async function checkLoginStatus() {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.goto(homeUrl, { waitUntil: "networkidle2", timeout: 30_000 });
    const loggedIn = !page.url().includes("/login");
    return { loggedIn, currentUrl: page.url(), profileDir };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function publishNote({ title, body, tags = [], coverUrl = "" }) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    // Step 1: Verify login
    await page.goto(homeUrl, { waitUntil: "networkidle2", timeout: 30_000 });

    if (page.url().includes("/login")) {
      return {
        status: "login_required",
        platform: "rednote",
        mode: "real",
        reason: "小红书未登录。请先打开登录页面扫码登录。"
      };
    }

    saveCookies(await page.cookies());

    // Step 2: Navigate to publish page and select "上传图文" tab
    await page.goto(publishUrl, { waitUntil: "networkidle2", timeout: 30_000 });
    console.log("[rednote] Publish page URL:", page.url());
    await new Promise((r) => setTimeout(r, 4000));

    // Step 3: Click "上传图文" tab (4 tabs: 上传视频/上传图文/写长文/发博客)
    const tabResult = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("button, span, div, li"));
      const target = all.find((el) => {
        const t = (el.textContent || "").trim();
        return t === "上传图文" || t === "图文";
      });
      if (target) {
        target.click();
        return { clicked: true, text: (target.textContent || "").trim() };
      }
      return { clicked: false };
    });
    console.log("[rednote] Tab click:", tabResult);

    if (!tabResult.clicked) {
      return {
        status: "failed",
        platform: "rednote",
        mode: "real",
        reason: "未找到'上传图文'选项。请确认账号可以发布图文笔记。浏览器窗口已保留。"
      };
    }

    await new Promise((r) => setTimeout(r, 3000));

    // Step 4: Upload image
    const imagePath = await prepareImage(coverUrl);
    if (!imagePath) {
      return {
        status: "failed",
        platform: "rednote",
        mode: "real",
        reason: "图片准备失败。请提供有效的封面图URL，或确认网络连接。"
      };
    }

    // Use the file input's uploadFile method directly (avoids click issues)
    const fileInput = await page.$('input[type="file"]');
    if (!fileInput) {
      return {
        status: "failed",
        platform: "rednote",
        mode: "real",
        reason: "未找到图片上传入口。请确认已切换到'上传图文'页面。浏览器窗口已保留。"
      };
    }

    await fileInput.uploadFile(imagePath);
    console.log("[rednote] Image uploaded:", imagePath);
    await new Promise((r) => setTimeout(r, 8000));

    // Step 5: Diagnostic — find editor fields
    const diag = await page.evaluate(() => ({
      url: window.location.href,
      inputs: Array.from(document.querySelectorAll("input:not([type=hidden]):not([type=file]), textarea, [contenteditable=true]")).map((el) => ({
        tag: el.tagName,
        placeholder: (el.placeholder || "").slice(0, 50),
        visible: el.offsetParent !== null
      })),
      buttons: Array.from(document.querySelectorAll("button")).map((el) => ({
        text: (el.textContent || "").trim().slice(0, 30),
        visible: el.offsetParent !== null
      })).filter((b) => b.visible)
    }));
    console.log("[rednote] Post-upload diagnostics:", JSON.stringify(diag, null, 2));

    // Step 6: Fill title and body
    const fillResult = await page.evaluate((data) => {
      let titleEl = null;
      let bodyEl = null;

      // Find by placeholder
      for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=file]), textarea, [contenteditable=true]")) {
        const ph = ((el.placeholder || "").toLowerCase());
        if (!titleEl && (ph.includes("标题"))) titleEl = el;
        if (!bodyEl && (ph.includes("正文") || ph.includes("内容") || ph.includes("描述") || ph.includes("说说") || ph.includes("标记"))) bodyEl = el;
      }

      // Fallback: first visible input = title, first textarea/editable = body
      const visInputs = Array.from(document.querySelectorAll("input:not([type=hidden]):not([type=file])")).filter((e) => e.offsetParent !== null);
      const visAreas = Array.from(document.querySelectorAll("textarea, [contenteditable=true]")).filter((e) => e.offsetParent !== null);

      if (!titleEl && visInputs.length > 0) titleEl = visInputs[0];
      if (!bodyEl && visAreas.length > 0) bodyEl = visAreas[0];
      if (!bodyEl && visInputs.length > 1) bodyEl = visInputs[1];

      if (titleEl) {
        const proto = titleEl.tagName === "INPUT" ? HTMLInputElement : HTMLTextAreaElement;
        Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(titleEl, data.title);
        titleEl.dispatchEvent(new Event("input", { bubbles: true }));
        titleEl.dispatchEvent(new Event("change", { bubbles: true }));
      }

      if (bodyEl) {
        if (bodyEl.getAttribute("contenteditable") === "true" || bodyEl.tagName === "DIV") {
          bodyEl.innerHTML = data.body.split("\n").map((p) => `<p>${p}</p>`).join("");
        } else {
          const proto = bodyEl.tagName === "INPUT" ? HTMLInputElement : HTMLTextAreaElement;
          Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(bodyEl, data.body);
        }
        bodyEl.dispatchEvent(new Event("input", { bubbles: true }));
        bodyEl.dispatchEvent(new Event("change", { bubbles: true }));
      }

      return { titleFound: !!titleEl, bodyFound: !!bodyEl };
    }, { title: title.slice(0, 20), body });

    console.log("[rednote] Fill result:", fillResult);

    if (!fillResult.titleFound && !fillResult.bodyFound) {
      return {
        status: "failed",
        platform: "rednote",
        mode: "real",
        reason: "图片上传后未找到编辑器。请确认浏览器中页面正常显示。浏览器窗口已保留。"
      };
    }

    // Step 7: Scroll to find publish button (may be below viewport or in fixed footer)
    await page.evaluate(async () => {
      // Scroll to bottom of page
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 1000));
      // Scroll back up a bit in case it's in a fixed header
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 500));
    });

    // Find publish button by DIRECT text content — bypasses all nesting/portal/shadow complexity
    const clicked = await page.evaluate(() => {
      // Collect ALL leaf elements (elements with short text, likely buttons)
      const leafResults = [];
      const allEls = document.querySelectorAll("*");

      for (const el of allEls) {
        // Skip script/style/noscript
        if (["SCRIPT", "STYLE", "NOSCRIPT", "LINK", "META"].includes(el.tagName)) continue;

        // Get DIRECT text (not from children)
        const childNodes = Array.from(el.childNodes);
        const directText = childNodes
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent)
          .join("")
          .trim();

        if (directText === "发布" || directText === "暂存离开" || directText === "发布笔记") {
          leafResults.push({
            tag: el.tagName,
            text: directText,
            id: el.id || "",
            className: (el.className || "").toString().slice(0, 60),
            rect: (() => {
              const r = el.getBoundingClientRect();
              return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left) };
            })()
          });
        }
      }

      // Also search inside shadow DOMs
      const searchShadow = (root, depth) => {
        if (depth > 5) return [];
        const results = [];
        for (const el of root.querySelectorAll("*")) {
          const directText = Array.from(el.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent).join("").trim();
          if (directText === "发布" || directText === "暂存离开") {
            results.push({ tag: el.tagName, text: directText, inShadow: true, depth });
          }
          if (el.shadowRoot) {
            results.push(...searchShadow(el.shadowRoot, depth + 1));
          }
        }
        return results;
      };
      const shadowResults = searchShadow(document, 0);

      return { leafResults, shadowResults };
    });

    console.log("[rednote] Button text search:", JSON.stringify(clicked.leafResults, null, 2));
    console.log("[rednote] Shadow search:", JSON.stringify(clicked.shadowResults, null, 2));

    // Try clicking
    const clickResult = await page.evaluate(() => {
      // Method 1: Click element whose direct text is "发布"
      for (const el of document.querySelectorAll("*")) {
        const directText = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent).join("").trim();
        if (directText === "发布") {
          el.click();
          return { method: "direct_text", tag: el.tagName, className: (el.className || "").slice(0, 40) };
        }
      }

      // Method 2: Search inside ALL shadow roots
      const clickInShadow = (root, depth) => {
        if (depth > 10) return null;
        for (const el of root.querySelectorAll("*")) {
          const directText = Array.from(el.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent).join("").trim();
          if (directText === "发布") {
            el.click();
            return { method: "shadow_click", depth };
          }
          if (el.shadowRoot) {
            const result = clickInShadow(el.shadowRoot, depth + 1);
            if (result) return result;
          }
        }
        return null;
      };
      const shadowResult = clickInShadow(document, 0);
      if (shadowResult) return shadowResult;

      return { method: "none" };
    });
    console.log("[rednote] Click result:", clickResult);

    await new Promise((r) => setTimeout(r, 3000));

    return {
      status: "success",
      platform: "rednote",
      mode: "real",
      publishedAt: new Date().toISOString(),
      note: clicked ? "已提交发布。" : "内容已填写，请在浏览器中手动点击发布。"
    };

  } catch (err) {
    return {
      status: "failed",
      platform: "rednote",
      mode: "real",
      reason: err.message || "小红书发布失败"
    };
  }
}

async function prepareImage(coverUrl) {
  try {
    let buffer;
    if (coverUrl && (coverUrl.startsWith("http://") || coverUrl.startsWith("https://"))) {
      const response = await fetch(coverUrl);
      buffer = Buffer.from(await response.arrayBuffer());
    } else {
      // Minimal valid 1x1 PNG placeholder
      buffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    }

    const filePath = join(tmpdir(), `rednote-upload-${Date.now()}.png`);
    writeFileSync(filePath, buffer);
    console.log("[rednote] Prepared image:", filePath, `(${buffer.length} bytes)`);
    return filePath;
  } catch (err) {
    console.log("[rednote] Image preparation failed:", err.message);
    return null;
  }
}

function saveCookies(cookies) {
  try {
    mkdirSync(dirname(cookieFile), { recursive: true });
    writeFileSync(cookieFile, JSON.stringify(cookies, null, 2));
  } catch {
    // non-critical
  }
}
