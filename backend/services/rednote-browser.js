import puppeteer from "puppeteer";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const profileDir = join(__dirname, "..", "data", "rednote-profile");
const cookieFile = join(__dirname, "..", "data", "rednote-cookies.json");
const loginUrl = "https://creator.xiaohongshu.com/login";
const homeUrl = "https://creator.xiaohongshu.com/";
const publishPageUrl = "https://creator.xiaohongshu.com/publish/imgNote";

const CREATE_NOTE_API = "https://edith.xiaohongshu.com/web_api/sns/v2/note";
const UPLOAD_PERMIT_API = "https://creator.xiaohongshu.com/api/media/v1/upload/web/permit";

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
    // Step 1: Navigate to creator center to ensure we're logged in
    await page.goto(homeUrl, { waitUntil: "networkidle2", timeout: 30_000 });

    if (page.url().includes("/login")) {
      return {
        status: "login_required",
        platform: "rednote",
        mode: "real",
        reason: "小红书未登录。请先打开登录页面扫码登录。"
      };
    }

    // Step 2: Navigate to publish page so the page's JS loads (needed for X-S/X-T generation)
    await page.goto(publishPageUrl, { waitUntil: "networkidle2", timeout: 30_000 });
    console.log("[rednote] Publish page loaded:", page.url());

    // Step 3: Extract cookies for API calls
    const cookies = await page.cookies();
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const a1Cookie = cookies.find((c) => c.name === "a1");
    const a1 = a1Cookie ? a1Cookie.value : "";
    saveCookies(cookies);

    // Step 4: Call the create note API from within the page context
    // This lets the page's JavaScript handle X-S/X-T signature generation
    const result = await page.evaluate(async (args) => {
      const { title, body, tags, createNoteApi } = args;

      // Build the note payload
      const noteData = {
        common: {
          type: "normal",
          title: title.slice(0, 20),
          note_id: "",
          desc: body.slice(0, 3000),
          source: JSON.stringify({
            type: "web",
            ids: "",
            extraInfo: JSON.stringify({ subType: "", systemId: "web" })
          }),
          business_binds: JSON.stringify({
            version: 1,
            noteId: 0,
            bizType: 0,
            noteOrderBind: {},
            notePostTiming: { postTime: "" },
            noteCollectionBind: { id: "" }
          }),
          ats: [],
          hash_tag: tags.slice(0, 10).map((t) => ({
            id: "",
            name: t.replace(/^#/, ""),
            link: "",
            type: "topic"
          })),
          post_loc: {},
          privacy_info: { op_type: 1, type: 0 }
        },
        image_info: {
          images: []
        },
        video_info: null
      };

      // Try using the page's own axios/fetch mechanism
      // The page may expose a global API client
      try {
        const resp = await fetch(createNoteApi, {
          method: "POST",
          headers: { "Content-Type": "application/json;charset=UTF-8" },
          credentials: "include",
          body: JSON.stringify(noteData)
        });
        const data = await resp.json();
        return { success: data.success || data.code === 0, data, method: "fetch" };
      } catch (e) {
        return { success: false, error: e.message, method: "fetch_failed" };
      }
    }, { title, body, tags, createNoteApi: CREATE_NOTE_API });

    console.log("[rednote] API result:", JSON.stringify(result).slice(0, 300));

    if (result.success) {
      return {
        status: "success",
        platform: "rednote",
        mode: "real",
        publishedAt: new Date().toISOString(),
        note: "已提交至小红书创作者中心，请检查发布结果。"
      };
    }

    // Step 5: Fallback — use DOM-based approach on the publish page
    console.log("[rednote] API approach failed, trying DOM-based fallback...");
    return await domBasedPublish(page, { title, body, tags, coverUrl });

  } catch (err) {
    return {
      status: "failed",
      platform: "rednote",
      mode: "real",
      reason: err.message || "小红书发布失败"
    };
  }
}

async function domBasedPublish(page, { title, body, tags = [], coverUrl = "" }) {
  try {
    // Reload publish page to get fresh state
    await page.goto(publishPageUrl, { waitUntil: "networkidle2", timeout: 30_000 });

    // Wait for editor to be ready
    await new Promise((r) => setTimeout(r, 3000));

    // Try filling title via the page's internal state
    const filled = await page.evaluate(async (data) => {
      // Try to find and fill the title input
      const titleInput = document.querySelector(
        'input[placeholder*="标题"], [class*="title"] input, [class*="Title"] input, input[type="text"]'
      );
      if (titleInput) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, "value"
        ).set;
        nativeInputValueSetter.call(titleInput, data.title);
        titleInput.dispatchEvent(new Event("input", { bubbles: true }));
        titleInput.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // Try to fill body via contenteditable or textarea
      const editor = document.querySelector(
        '[contenteditable="true"], [class*="editor"], [class*="Editor"], textarea, [role="textbox"]'
      );
      if (editor) {
        if (editor.getAttribute("contenteditable") === "true") {
          editor.innerHTML = data.body.split("\n").map((p) => `<p>${p}</p>`).join("");
          editor.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, "value"
          ).set;
          nativeSetter.call(editor, data.body);
          editor.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }

      return { titleFound: !!titleInput, editorFound: !!editor };
    }, { title: title.slice(0, 20), body });

    console.log("[rednote] DOM fill result:", filled);

    if (!filled.titleFound && !filled.editorFound) {
      return {
        status: "failed",
        platform: "rednote",
        mode: "real",
        reason: "小红书编辑器未找到。请确认创作者中心页面正常加载。浏览器窗口保留以便手动发布。"
      };
    }

    // Try clicking publish
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button, [role='button'], .btn, [class*='button']"));
      const publishBtn = buttons.find((btn) => {
        const text = (btn.textContent || "").trim();
        return text === "发布" || text === "提交" || text === "立即发布";
      });
      if (publishBtn) {
        publishBtn.click();
        return true;
      }
      return false;
    });

    if (!clicked) {
      return {
        status: "manual_required",
        platform: "rednote",
        mode: "real",
        reason: "内容已填入编辑器，但未找到发布按钮。请在浏览器中手动点击发布。"
      };
    }

    await new Promise((r) => setTimeout(r, 3000));

    return {
      status: "success",
      platform: "rednote",
      mode: "real",
      publishedAt: new Date().toISOString(),
      note: "已点击发布按钮，请检查小红书创作者中心确认结果。"
    };

  } catch (err) {
    return {
      status: "failed",
      platform: "rednote",
      mode: "real",
      reason: err.message || "DOM发布失败"
    };
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
