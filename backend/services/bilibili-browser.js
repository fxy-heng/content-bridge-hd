import puppeteer from "puppeteer";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const profileDir = join(__dirname, "..", "data", "bilibili-profile");
const loginUrl = "https://passport.bilibili.com/login";
const creatorHomeUrl = "https://member.bilibili.com/platform/home";
const articleEditorUrls = [
  "https://member.bilibili.com/york/read-editor",
  "https://member.bilibili.com/platform/upload/text/edit"
];

let browserInstance = null;
let loginPage = null;

async function getBrowser() {
  if (browserInstance?.isConnected()) {
    return browserInstance;
  }

  mkdirSync(profileDir, { recursive: true });
  browserInstance = await puppeteer.launch({
    headless: process.env.BILIBILI_HEADLESS === "1" ? "new" : false,
    userDataDir: profileDir,
    defaultViewport: { width: 1366, height: 900 },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate"
    ],
    ignoreDefaultArgs: ["--enable-automation"]
  });

  return browserInstance;
}

export async function openLoginPage() {
  const browser = await getBrowser();
  loginPage = await browser.newPage();
  await loginPage.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

  return {
    ok: true,
    platform: "bilibili",
    status: "login_required",
    loginUrl,
    profileDir,
    message: "Scan the QR code in the opened browser window, then refresh Bilibili login status."
  };
}

export async function checkLoginStatus() {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.goto(creatorHomeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 10_000 }).catch(() => {});
    const currentUrl = page.url();
    const loggedIn = !isLoginUrl(currentUrl);

    return {
      loggedIn,
      currentUrl,
      profileDir
    };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function publishArticle({ title, body, tags = [], coverUrl = "" }) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const diagnostics = [];

  try {
    const currentUrl = await gotoEditor(page, diagnostics);
    diagnostics.push(`editor_url=${currentUrl}`);

    if (isLoginUrl(page.url())) {
      return {
        status: "login_required",
        platform: "bilibili",
        mode: "real",
        reason: "Bilibili login is required. Open the login window and scan the QR code.",
        currentUrl: page.url(),
        diagnostics
      };
    }

    const titleFilled = await fillFirst(page, [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      'input[maxlength="80"]',
      'input[type="text"]'
    ], title.slice(0, 80));

    if (!titleFilled) {
      return failed("Bilibili article title input was not found. The editor UI may have changed.", page, diagnostics);
    }
    diagnostics.push("title_filled");

    const bodyFilled = await fillFirst(page, [
      'div[contenteditable="true"]',
      ".ql-editor",
      ".ProseMirror",
      '[role="textbox"]',
      "textarea"
    ], body.slice(0, 50_000));

    if (!bodyFilled) {
      return failed("Bilibili article editor was not found. The editor UI may have changed.", page, diagnostics);
    }
    diagnostics.push("body_filled");

    if (Array.isArray(tags) && tags.length) {
      const tagFilled = await fillFirst(page, [
        'input[placeholder*="标签"]',
        'input[placeholder*="tag"]'
      ], tags.slice(0, 10).join(","));
      diagnostics.push(tagFilled ? "tags_filled" : "tags_skipped");
    }

    const clicked = await clickButtonByText(page, ["发布", "提交", "立即发布"]);
    if (!clicked) {
      return {
        status: "manual_required",
        platform: "bilibili",
        mode: "real",
        reason: "Content was filled in Bilibili, but the publish button was not found. Please click publish manually in the kept-open browser page.",
        currentUrl: page.url(),
        diagnostics
      };
    }

    diagnostics.push("publish_clicked");
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: 15_000 }).catch(() => {});

    return {
      status: "success",
      platform: "bilibili",
      mode: "real",
      publishedAt: new Date().toISOString(),
      currentUrl: page.url(),
      diagnostics,
      note: "The submit action was clicked in Bilibili Creator Center. Check the creator center for final review status."
    };
  } catch (error) {
    return failed(error.message || "Bilibili publish automation failed.", page, diagnostics);
  }
}

async function gotoEditor(page, diagnostics) {
  let lastError = null;
  for (const url of articleEditorUrls) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForNetworkIdle({ idleTime: 800, timeout: 12_000 }).catch(() => {});
      if (page.url() !== "about:blank") {
        diagnostics.push(`tried=${url}`);
        return page.url();
      }
    } catch (error) {
      lastError = error;
      diagnostics.push(`failed_url=${url}`);
    }
  }
  throw lastError || new Error("Bilibili editor did not open.");
}

async function fillFirst(page, selectors, text) {
  for (const selector of selectors) {
    const element = await page.$(selector).catch(() => null);
    if (!element) {
      continue;
    }

    await element.click({ clickCount: 3 }).catch(() => {});
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await element.type(text, { delay: 1 });
    return true;
  }
  return false;
}

async function clickButtonByText(page, labels) {
  return page.evaluate((buttonLabels) => {
    const candidates = Array.from(document.querySelectorAll("button,[role='button'],.btn,[class*='button']"));
    const target = candidates.find((element) => {
      const text = (element.textContent || "").replace(/\s+/g, "");
      return buttonLabels.some((label) => text.includes(label));
    });
    if (!target) {
      return false;
    }
    target.click();
    return true;
  }, labels);
}

function failed(reason, page, diagnostics) {
  return {
    status: "failed",
    platform: "bilibili",
    mode: "real",
    reason,
    currentUrl: page.url(),
    diagnostics
  };
}

function isLoginUrl(url) {
  return /passport\.bilibili\.com|\/login/i.test(url);
}
