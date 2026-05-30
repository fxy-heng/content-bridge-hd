import puppeteer from "puppeteer";
import { XhsClient, NeedVerifyError, XhsApiError } from "@lucasygu/redbook";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const profileDir = join(__dirname, "..", "data", "rednote-profile");
const cookieFile = join(__dirname, "..", "data", "rednote-cookies.json");
const loginUrl = "https://creator.xiaohongshu.com/login";
const homeUrl = "https://creator.xiaohongshu.com/";
const webHomeUrl = "https://www.xiaohongshu.com/";
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

    const cookies = await readXhsCookies(page);
    saveCookies(cookies.raw);

    const apiPublish = await publishNoteViaApi({ title, body, tags, coverUrl, cookies: cookies.map });
    if (apiPublish.status === "success") {
      return apiPublish;
    }
    console.log("[rednote] API publish fallback:", apiPublish.reason);

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

    // Step 7: Click the real publish control. Xiaohongshu renders the final
    // action bar as a fixed footer, so DOM text search alone can find labels
    // without actually activating the visible red button.
    const buttonDiagnostics = await inspectPublishControls(page);
    const buttonCandidates = buttonDiagnostics.candidates;
    console.log("[rednote] Publish button candidates:", JSON.stringify(buttonCandidates, null, 2));
    console.log("[rednote] Publish text matches:", JSON.stringify(buttonDiagnostics.textMatches, null, 2));

    const clickResult = await clickPublishButton(page, buttonCandidates);
    console.log("[rednote] Click result:", clickResult);

    if (!clickResult.clicked) {
      return {
        status: "manual_required",
        platform: "rednote",
        mode: "real",
        reason: `API 发布未成功：${apiPublish.reason}。页面内容已填写，但未能定位到底部固定栏里的红色“发布”按钮。`,
        detail: { apiPublish, buttonDiagnostics, clickResult, currentUrl: page.url() }
      };
    }

    await new Promise((r) => setTimeout(r, 5000));

    const afterClick = await page.evaluate(() => ({
      url: window.location.href,
      dialogs: Array.from(document.querySelectorAll('[role="dialog"], .modal, [class*="modal"], [class*="dialog"]'))
        .map((el) => (el.textContent || "").trim().slice(0, 120))
        .filter(Boolean),
      visibleButtons: Array.from(document.querySelectorAll("button,[role='button']"))
        .filter((el) => el.offsetParent !== null)
        .map((el) => (el.textContent || "").trim())
        .filter(Boolean)
        .slice(0, 30)
    }));
    console.log("[rednote] After publish click:", JSON.stringify(afterClick, null, 2));

    const stillOnPublishPage = afterClick.url.includes("/publish");
    const publishStillVisible = afterClick.visibleButtons.some((text) => text === "发布" || text === "发布笔记");
    const hasBlockingDialog = afterClick.dialogs.some((text) => /失败|错误|违规|不能为空|请上传|请填写|登录|验证/.test(text));

    if (hasBlockingDialog || (stillOnPublishPage && publishStillVisible)) {
      return {
        status: "manual_required",
        platform: "rednote",
        mode: "real",
        reason: `API 发布未成功：${apiPublish.reason}。已点击小红书发布按钮，但页面仍停留在发布确认/校验状态。`,
        detail: { apiPublish, clickResult, afterClick }
      };
    }

    return {
      status: "success",
      platform: "rednote",
      mode: "real",
      publishedAt: new Date().toISOString(),
      note: "已点击小红书底部固定栏发布按钮，页面状态已变化。请在创作者中心确认最终发布结果。",
      detail: { clickResult, afterClick }
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

export async function diagnoseApiPublishReadiness() {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.goto(homeUrl, { waitUntil: "networkidle2", timeout: 30_000 });
    if (page.url().includes("/login")) {
      return {
        ok: false,
        platform: "rednote",
        currentUrl: page.url(),
        reason: "小红书未登录，无法读取 API 发布所需 Cookie。"
      };
    }

    const cookies = await readXhsCookies(page);
    const missing = ["a1", "web_session"].filter((key) => !cookies.map[key]);
    if (missing.length) {
      return {
        ok: false,
        platform: "rednote",
        currentUrl: page.url(),
        cookieNames: Object.keys(cookies.map).sort(),
        missing,
        reason: `登录态存在，但缺少 API 发布必需 Cookie：${missing.join(", ")}。`
      };
    }

    const client = new XhsClient(cookies.map);
    const self = await client.getSelfInfo();
    const uploadPermit = await client.getUploadPermit("image", 1);
    return {
      ok: true,
      platform: "rednote",
      currentUrl: page.url(),
      cookieNames: Object.keys(cookies.map).sort(),
      uploadPermit: {
        fileId: Boolean(uploadPermit.fileId),
        token: Boolean(uploadPermit.token)
      },
      self
    };
  } catch (error) {
    return {
      ok: false,
      platform: "rednote",
      reason: formatApiPublishError(error),
      detail: { name: error.name, code: error.code, response: error.response }
    };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function diagnosePublishPageControls() {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.goto(publishUrl, { waitUntil: "networkidle2", timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 3000));
    const diagnostics = await inspectPublishControls(page);
    return { ok: true, platform: "rednote", diagnostics };
  } catch (error) {
    return {
      ok: false,
      platform: "rednote",
      reason: error.message || "小红书发布页控件诊断失败"
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function inspectPublishControls(page) {
  const candidates = await findPublishButtonCandidates(page);
  const pageInfo = await page.evaluate(() => ({
    url: window.location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scroll: { x: window.scrollX, y: window.scrollY }
  }));
  const textMatches = await page.evaluate(() => Array.from(document.querySelectorAll("body *"))
    .map((el) => {
      const text = (el.innerText || el.textContent || "").replace(/\s+/g, "").trim();
      const directText = Array.from(el.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join("")
        .replace(/\s+/g, "")
        .trim();
      if (!text.includes("暂存离开") && text !== "发布" && directText !== "发布" && !text.includes("暂存离开发布")) {
        return null;
      }
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        tag: el.tagName,
        text: text.slice(0, 120),
        directText: directText.slice(0, 80),
        className: String(el.className || "").slice(0, 120),
        rect: {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          centerX: Math.round(rect.left + rect.width / 2),
          centerY: Math.round(rect.top + rect.height / 2)
        },
        position: style.position,
        backgroundColor: style.backgroundColor,
        visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
      };
    })
    .filter(Boolean)
    .slice(0, 80));
  const visualMatches = await page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    return Array.from(document.querySelectorAll("body *"))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const bg = style.backgroundColor;
        const redBg = /rgba?\(\s*(2[0-5]\d|1[8-9]\d)\s*,\s*([0-8]?\d|9[0-9]|1[0-2]\d)\s*,\s*([0-8]?\d|9[0-9]|1[0-2]\d)/.test(bg);
        if (
          !redBg ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          rect.top < viewport.height - 120 ||
          rect.width < 20 ||
          rect.height < 20
        ) {
          return null;
        }
        return {
          tag: el.tagName,
          text: (el.innerText || el.textContent || "").replace(/\s+/g, "").trim().slice(0, 80),
          className: String(el.className || "").slice(0, 120),
          rect: {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            centerX: Math.round(rect.left + rect.width / 2),
            centerY: Math.round(rect.top + rect.height / 2)
          },
          position: style.position,
          backgroundColor: bg,
          borderRadius: style.borderTopLeftRadius
        };
      })
      .filter(Boolean)
      .slice(0, 30);
  });
  return { pageInfo, textMatches, visualMatches, candidates };
}

async function publishNoteViaApi({ title, body, tags = [], coverUrl = "", cookies }) {
  if (!cookies.a1 || !cookies.web_session) {
    return {
      status: "failed",
      platform: "rednote",
      mode: "real",
      reason: "小红书 API 发布缺少 a1 或 web_session Cookie，回退浏览器自动化。"
    };
  }

  try {
    const imagePath = await prepareImage(coverUrl);
    if (!imagePath) {
      return {
        status: "failed",
        platform: "rednote",
        mode: "real",
        reason: "图片准备失败，回退浏览器自动化。"
      };
    }

    const client = new XhsClient(cookies);
    const { fileId, token } = await client.getUploadPermit("image", 1);
    await client.uploadFile(fileId, token, imagePath, contentTypeForPath(imagePath));

    const desc = appendHashtags(body, tags);
    const result = await client.createImageNote(title.slice(0, 20), desc, [fileId]);
    const noteId = result?.note_id || result?.noteId || result?.id || "";
    const xsecToken = result?.xsec_token || result?.xsecToken || "";

    return {
      status: "success",
      platform: "rednote",
      mode: "real",
      publishedAt: new Date().toISOString(),
      note: "已通过小红书创作者 API 提交图文笔记。",
      noteId,
      webUrl: noteId ? buildRednoteWebUrl(noteId, xsecToken) : "",
      detail: result
    };
  } catch (error) {
    const reason = formatApiPublishError(error);
    return {
      status: "failed",
      platform: "rednote",
      mode: "real",
      reason,
      detail: { name: error.name, code: error.code, response: error.response }
    };
  }
}

async function readXhsCookies(page) {
  const currentUrl = page.url();
  await page.goto(webHomeUrl, { waitUntil: "networkidle2", timeout: 30_000 }).catch(() => {});
  const raw = await page.cookies("https://www.xiaohongshu.com", "https://creator.xiaohongshu.com");
  if (currentUrl && !currentUrl.includes("xiaohongshu.com/login")) {
    await page.goto(currentUrl, { waitUntil: "networkidle2", timeout: 30_000 }).catch(() => {});
  }
  const map = {};
  raw.forEach((cookie) => {
    map[cookie.name] = cookie.value;
  });
  return { raw, map };
}

function appendHashtags(body, tags = []) {
  const normalized = tags
    .map((tag) => String(tag || "").replace(/^#/, "").trim())
    .filter(Boolean);
  if (!normalized.length) {
    return body;
  }
  const suffix = normalized.map((tag) => `#${tag}`).join(" ");
  return body.includes(suffix) ? body : `${body}\n\n${suffix}`;
}

function contentTypeForPath(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/jpeg";
}

function buildRednoteWebUrl(noteId, xsecToken) {
  const params = xsecToken ? `?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=pc_share` : "";
  return `https://www.xiaohongshu.com/explore/${encodeURIComponent(noteId)}${params}`;
}

function formatApiPublishError(error) {
  if (error instanceof NeedVerifyError) {
    return `小红书 API 发布触发验证码/风控（${error.verifyType}），回退浏览器自动化。`;
  }
  if (error instanceof XhsApiError) {
    return `${error.message}，回退浏览器自动化。`;
  }
  return `${error.message || "小红书 API 发布失败"}，回退浏览器自动化。`;
}

async function findPublishButtonCandidates(page) {
  return page.evaluate(() => {
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };

    function isVisible(el) {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 20 &&
        rect.height > 20 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < viewport.height &&
        rect.left < viewport.width
      );
    }

    function textOf(el) {
      return (el.innerText || el.textContent || "").replace(/\s+/g, "").trim();
    }

    function directTextOf(el) {
      return Array.from(el.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join("")
        .replace(/\s+/g, "")
        .trim();
    }

    function fixedAncestor(el) {
      let current = el;
      while (current && current !== document.documentElement) {
        const style = window.getComputedStyle(current);
        if (style.position === "fixed" || style.position === "sticky") {
          return true;
        }
        current = current.parentElement;
      }
      return false;
    }

    function rectInfo(el) {
      const rect = el.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        centerX: Math.round(rect.left + rect.width / 2),
        centerY: Math.round(rect.top + rect.height / 2)
      };
    }

    function scoreCandidate(el, text, source = "button") {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const isFooter = fixedAncestor(el) || rect.top > viewport.height * 0.75;
      const inEditorArea = rect.left > 160 && rect.top > 80;
      const redLike = /rgb\(\s*(2[0-5]\d|1[8-9]\d)/.test(style.backgroundColor) || /#?ff|red|primary|submit|publish/i.test(String(el.className));

      return {
        text,
        source,
        tag: el.tagName,
        className: String(el.className || "").slice(0, 100),
        role: el.getAttribute("role") || "",
        rect: rectInfo(el),
        disabled: Boolean(el.disabled) || el.getAttribute("aria-disabled") === "true",
        fixedOrSticky: fixedAncestor(el),
        footerLike: isFooter,
        editorArea: inEditorArea,
        backgroundColor: style.backgroundColor,
        score: 100 + (isFooter ? 40 : 0) + (redLike ? 20 : 0) + (inEditorArea ? 20 : 0) + (el.tagName === "BUTTON" ? 10 : 0)
      };
    }

    function findActionBars() {
      return Array.from(document.querySelectorAll("body *"))
        .filter(isVisible)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const text = textOf(el);
          const style = window.getComputedStyle(el);
          return { el, text, rect, style };
        })
        .filter(({ text, rect }) => (
          text.includes("暂存离开") &&
          text.includes("发布") &&
          rect.left > 120 &&
          rect.top > viewport.height * 0.65 &&
          rect.width >= 160 &&
          rect.height >= 36
        ))
        .sort((a, b) => {
          const areaA = a.rect.width * a.rect.height;
          const areaB = b.rect.width * b.rect.height;
          return areaA - areaB;
        });
    }

    const actionBars = findActionBars();
    const candidates = [];

    for (const { el: bar } of actionBars.slice(0, 4)) {
      const innerControls = Array.from(bar.querySelectorAll("button,[role='button'],.btn,[class*='btn'],[class*='button'],div,span"))
        .filter(isVisible)
        .map((el) => ({ el, text: textOf(el), directText: directTextOf(el) }))
        .filter(({ text, directText }) => text === "发布" || directText === "发布")
        .map(({ el }) => scoreCandidate(el, "发布", "action_bar_child"));
      candidates.push(...innerControls);

      const publishTextNode = Array.from(bar.querySelectorAll("*"))
        .filter(isVisible)
        .find((el) => directTextOf(el) === "发布" || textOf(el) === "发布");
      if (publishTextNode) {
        const control = publishTextNode.closest("button,[role='button'],.btn,[class*='btn'],[class*='button']") || publishTextNode;
        candidates.push(scoreCandidate(control, "发布", "action_bar_text"));
      }

      const barRect = bar.getBoundingClientRect();
      candidates.push({
        text: "发布",
        source: "action_bar_right_fallback",
        tag: bar.tagName,
        className: String(bar.className || "").slice(0, 100),
        role: bar.getAttribute("role") || "",
        rect: {
          left: Math.round(barRect.left + barRect.width * 0.55),
          top: Math.round(barRect.top),
          width: Math.round(barRect.width * 0.42),
          height: Math.round(barRect.height),
          centerX: Math.round(barRect.left + barRect.width * 0.76),
          centerY: Math.round(barRect.top + barRect.height / 2)
        },
        disabled: false,
        fixedOrSticky: fixedAncestor(bar),
        footerLike: true,
        editorArea: true,
        backgroundColor: window.getComputedStyle(bar).backgroundColor,
        score: 120
      });
    }

    const globalBottomButtons = Array.from(document.querySelectorAll("button,[role='button'],.btn,[class*='btn'],[class*='button']"))
      .filter(isVisible)
      .map((el) => ({ el, text: textOf(el), directText: directTextOf(el) }))
      .filter(({ text, directText, el }) => {
        const rect = el.getBoundingClientRect();
        return (
          (text === "发布" || directText === "发布") &&
          rect.left > 160 &&
          rect.top > viewport.height * 0.7
        );
      })
      .map(({ el }) => scoreCandidate(el, "发布", "global_bottom_button"));
    candidates.push(...globalBottomButtons);

    const visualBottomRedButtons = Array.from(document.querySelectorAll("body *"))
      .filter(isVisible)
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const bg = style.backgroundColor;
        const borderRadius = Number.parseFloat(style.borderTopLeftRadius || "0");
        const redBg = /rgba?\(\s*(2[0-5]\d|1[8-9]\d)\s*,\s*([0-8]?\d|9[0-9]|1[0-2]\d)\s*,\s*([0-8]?\d|9[0-9]|1[0-2]\d)/.test(bg);
        return (
          redBg &&
          rect.left > 300 &&
          rect.left < viewport.width * 0.75 &&
          rect.top > viewport.height - 140 &&
          rect.width >= 60 &&
          rect.width <= 180 &&
          rect.height >= 28 &&
          rect.height <= 70 &&
          borderRadius >= 8
        );
      })
      .map((el) => {
        const candidate = scoreCandidate(el, "发布", "visual_bottom_red");
        candidate.score += 80;
        return candidate;
      });
    candidates.push(...visualBottomRedButtons);

    const fixedFooterRedButtons = Array.from(document.querySelectorAll("body *"))
      .filter((el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const bg = style.backgroundColor;
        const redBg = /rgba?\(\s*(2[0-5]\d|1[8-9]\d)\s*,\s*([0-8]?\d|9[0-9]|1[0-2]\d)\s*,\s*([0-8]?\d|9[0-9]|1[0-2]\d)/.test(bg);
        const fixed = fixedAncestor(el) || style.position === "fixed" || style.position === "sticky";
        return (
          redBg &&
          fixed &&
          rect.left > 300 &&
          rect.left < viewport.width * 0.75 &&
          rect.width >= 50 &&
          rect.width <= 220 &&
          rect.height >= 24 &&
          rect.height <= 80
        );
      })
      .map((el) => {
        const candidate = scoreCandidate(el, "发布", "fixed_footer_red");
        candidate.score += 120;
        return candidate;
      });
    candidates.push(...fixedFooterRedButtons);

    const coordinateFallbacks = [];
    const expectedPoints = [
      { x: Math.round(viewport.width * 0.49), y: viewport.height - 42, source: "viewport_bottom_expected" },
      { x: Math.round(viewport.width * 0.50), y: viewport.height - 32, source: "viewport_bottom_expected_low" },
      { x: 670, y: viewport.height - 32, source: "screenshot_ratio_expected" }
    ];
    for (const point of expectedPoints) {
      const el = document.elementFromPoint(point.x, point.y);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      coordinateFallbacks.push({
        text: "发布",
        source: point.source,
        tag: el.tagName,
        className: String(el.className || "").slice(0, 100),
        role: el.getAttribute("role") || "",
        rect: {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          centerX: point.x,
          centerY: point.y
        },
        disabled: false,
        fixedOrSticky: true,
        footerLike: true,
        editorArea: true,
        backgroundColor: window.getComputedStyle(el).backgroundColor,
        score: 90
      });
    }
    candidates.push(...coordinateFallbacks);

    const unique = new Map();
    for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
      const key = `${candidate.rect.centerX}:${candidate.rect.centerY}:${candidate.source}`;
      if (!unique.has(key)) {
        unique.set(key, candidate);
      }
    }

    return [...unique.values()].slice(0, 10);
  });
}

async function clickPublishButton(page, candidates) {
  const target = candidates.find((candidate) => !candidate.disabled && candidate.source !== "visual_bottom_red")
    || candidates.find((candidate) => !candidate.disabled);
  if (!target) {
    return { clicked: false, reason: "no_enabled_publish_button" };
  }

  const hitBefore = await page.evaluate((point) => {
    const el = document.elementFromPoint(point.x, point.y);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return {
      tag: el.tagName,
      text: (el.innerText || el.textContent || "").replace(/\s+/g, "").trim().slice(0, 80),
      className: String(el.className || "").slice(0, 120),
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      backgroundColor: style.backgroundColor,
      cursor: style.cursor
    };
  }, { x: target.rect.centerX, y: target.rect.centerY });

  await page.mouse.move(target.rect.centerX, target.rect.centerY);
  await page.mouse.down();
  await new Promise((r) => setTimeout(r, 120));
  await page.mouse.up();

  return {
    clicked: true,
    method: "mouse_coordinate",
    target,
    hitBefore
  };
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
