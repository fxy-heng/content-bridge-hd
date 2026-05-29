import puppeteer from "puppeteer";
import { join, dirname } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COOKIE_FILE = join(__dirname, "..", "data", "bilibili-cookies.json");
const BILIBILI_LOGIN = "https://passport.bilibili.com/login";
const BILIBILI_EDITOR = "https://member.bilibili.com/platform/upload/text/edit";

let browserInstance = null;

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  browserInstance = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: { width: 1280, height: 800 }
  });
  return browserInstance;
}

async function loadCookies(page) {
  if (existsSync(COOKIE_FILE)) {
    try {
      const cookies = JSON.parse(readFileSync(COOKIE_FILE, "utf8"));
      await page.setCookie(...cookies);
      return cookies.length > 0;
    } catch {
      return false;
    }
  }
  return false;
}

async function saveCookies(page) {
  const cookies = await page.cookies();
  mkdirSync(dirname(COOKIE_FILE), { recursive: true });
  writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
}

export async function checkLoginStatus() {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await loadCookies(page);
    await page.goto("https://member.bilibili.com/platform/home", {
      waitUntil: "networkidle2",
      timeout: 30000
    });

    const loggedIn = !page.url().includes("login");
    return { loggedIn, currentUrl: page.url() };
  } finally {
    await page.close();
  }
}

export async function publishArticle({ title, body, tags = [], coverUrl = "" }) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    // Load saved cookies
    const hasCookies = await loadCookies(page);

    // Navigate to article editor
    await page.goto(BILIBILI_EDITOR, { waitUntil: "networkidle2", timeout: 30000 });

    // Check if we need to login
    if (page.url().includes("login") || page.url().includes("passport")) {
      if (hasCookies) {
        throw new Error("B站登录状态已过期，请在浏览器中重新登录");
      }
      throw new Error("首次使用需要登录 B站。即将打开浏览器，请在浏览器中扫码登录后重试。");
    }

    // Wait for editor to load
    await page.waitForSelector('input[placeholder*="标题"]', { timeout: 15000 }).catch(() => {
      throw new Error("未找到 B站专栏编辑器页面，请确认创作中心页面正常加载");
    });

    // Fill title
    const titleInput = await page.$('input[placeholder*="标题"]');
    if (titleInput) {
      await titleInput.click();
      await page.keyboard.down("Control");
      await page.keyboard.press("KeyA");
      await page.keyboard.up("Control");
      await titleInput.type(title.slice(0, 100));
    }

    // Fill body — B站 uses a rich text editor, try finding the editor area
    const editorSelectors = [
      'div[contenteditable="true"]',
      ".editor-content",
      ".ql-editor",
      '[role="textbox"]'
    ];

    let editorFound = false;
    for (const selector of editorSelectors) {
      try {
        const editor = await page.$(selector);
        if (editor) {
          await editor.click();
          await page.keyboard.down("Control");
          await page.keyboard.press("KeyA");
          await page.keyboard.up("Control");
          await editor.type(body.slice(0, 50000));
          editorFound = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!editorFound) {
      throw new Error("未找到 B站专栏正文编辑器，请手动在浏览器中发布，或联系开发者更新选择器");
    }

    // Fill tags if any
    if (tags.length > 0) {
      const tagInput = await page.$('input[placeholder*="标签"]');
      if (tagInput) {
        await tagInput.type(tags.slice(0, 10).join(","));
      }
    }

    // Click publish button
    const publishSelectors = [
      'button:has-text("发布")',
      'button:has-text("提交")',
      '[class*="publish"]',
      '[class*="submit"]'
    ];

    let published = false;
    for (const selector of publishSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          await button.click();
          published = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!published) {
      // Save cookies and throw — user needs to manually publish
      await saveCookies(page);
      throw new Error("内容已填入编辑器，但未找到发布按钮。请手动点击发布。");
    }

    // Wait for success indication
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Save cookies for next time
    await saveCookies(page);

    return {
      status: "success",
      platform: "bilibili",
      publishedAt: new Date().toISOString(),
      note: "内容已提交至B站专栏。请检查B站创作中心确认发布结果。"
    };
  } catch (err) {
    // Save cookies even on error (they might still be valid)
    try {
      await saveCookies(page);
    } catch {
      // ignore
    }
    throw err;
  } finally {
    await page.close();
  }
}
