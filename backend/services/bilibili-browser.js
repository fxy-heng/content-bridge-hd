import puppeteer from "puppeteer";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const profileDir = join(__dirname, "..", "data", "bilibili-profile");
const loginUrl = "https://passport.bilibili.com/login";
const creatorHomeUrl = "https://member.bilibili.com/platform/home";
const articleEditorUrl = "https://member.bilibili.com/platform/upload/text/edit";

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
      "--disable-blink-features=AutomationControlled"
    ]
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
    message: "Scan the QR code in the opened browser window, then call /api/bilibili/status."
  };
}

export async function checkLoginStatus() {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.goto(creatorHomeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 10_000 }).catch(() => {});
    const currentUrl = page.url();
    const loggedIn = !/passport\.bilibili\.com|\/login/i.test(currentUrl);

    return {
      loggedIn,
      currentUrl,
      profileDir
    };
  } finally {
    await page.close();
  }
}

export async function publishArticle({ title, body, tags = [], coverUrl = "" }) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  let keepPageOpen = false;

  try {
    await page.goto(articleEditorUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 15_000 }).catch(() => {});

    if (/passport\.bilibili\.com|\/login/i.test(page.url())) {
      return {
        status: "login_required",
        platform: "bilibili",
        mode: "real",
        reason: "Bilibili login is required. Open /api/bilibili/login and scan the QR code."
      };
    }

    const titleFilled = await fillFirst(page, [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      'input[maxlength="80"]',
      'input[type="text"]'
    ], title.slice(0, 80));

    if (!titleFilled) {
      throw new Error("Bilibili article title input was not found. The creator center UI may have changed.");
    }

    const bodyFilled = await fillFirst(page, [
      'div[contenteditable="true"]',
      ".ql-editor",
      ".ProseMirror",
      '[role="textbox"]',
      "textarea"
    ], body.slice(0, 50_000));

    if (!bodyFilled) {
      throw new Error("Bilibili article editor was not found. The creator center UI may have changed.");
    }

    if (Array.isArray(tags) && tags.length) {
      await fillFirst(page, [
        'input[placeholder*="标签"]',
        'input[placeholder*="tag"]'
      ], tags.slice(0, 10).join(","));
    }

    const clicked = await clickButtonByText(page, ["发布", "提交", "立即发布"]);
    if (!clicked) {
      keepPageOpen = true;
      return {
        status: "manual_required",
        platform: "bilibili",
        mode: "real",
        reason: "Content has been filled in the Bilibili editor, but the publish button was not found. Please publish manually in the opened browser.",
        currentUrl: page.url()
      };
    }

    await page.waitForNetworkIdle({ idleTime: 1000, timeout: 15_000 }).catch(() => {});
    return {
      status: "success",
      platform: "bilibili",
      mode: "real",
      publishedAt: new Date().toISOString(),
      currentUrl: page.url(),
      note: "The submit action was clicked in Bilibili Creator Center. Check the creator center for final review status."
    };
  } finally {
    if (loginPage && !loginPage.isClosed()) {
      await loginPage.close().catch(() => {});
      loginPage = null;
    }
    if (!keepPageOpen) {
      await page.close().catch(() => {});
    }
  }
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
