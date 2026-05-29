import puppeteer from "puppeteer";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const profileDir = join(__dirname, "..", "data", "zhihu-profile");
const debugDir = join(__dirname, "..", "data", "zhihu-debug");
const loginUrl = "https://www.zhihu.com/signin";
const homeUrl = "https://www.zhihu.com/";
const articleEditorUrls = [
  "https://zhuanlan.zhihu.com/write",
  "https://www.zhihu.com/creator"
];

let browserInstance = null;
let loginCache = { checkedAt: 0, status: null };

async function getBrowser() {
  if (browserInstance?.isConnected()) {
    return browserInstance;
  }

  mkdirSync(profileDir, { recursive: true });
  try {
    browserInstance = await puppeteer.launch({
      headless: process.env.ZHIHU_HEADLESS === "1" ? "new" : false,
      executablePath: resolveBrowserPath(),
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
  } catch (error) {
    throw new Error(buildBrowserLaunchError(error));
  }

  return browserInstance;
}

export async function openLoginPage() {
  const browser = await getBrowser();
  const page = await getOrCreateZhihuPage(browser);
  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  loginCache = { checkedAt: 0, status: null };

  return {
    ok: true,
    platform: "zhihu",
    status: "login_required",
    loginUrl,
    profileDir,
    message: "Login in the opened Zhihu window, then refresh status."
  };
}

export async function checkLoginStatus() {
  if (loginCache.status && Date.now() - loginCache.checkedAt < 10_000) {
    return { ...loginCache.status, cached: true };
  }

  const browser = await getBrowser();
  const page = await getOrCreateZhihuPage(browser);
  await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
  await Promise.race([
    page.waitForFunction(() => !/signin|login/i.test(location.href), { timeout: 5_000 }),
    sleep(3_000)
  ]).catch(() => {});

  const currentUrl = page.url();
  const status = {
    loggedIn: !isLoginUrl(currentUrl),
    currentUrl,
    profileDir
  };
  loginCache = { checkedAt: Date.now(), status };
  return status;
}

export async function publishArticle({ title, body, tags = [], dryRun = false }) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const diagnostics = [];

  try {
    const editorUrl = await gotoEditor(page, diagnostics);
    diagnostics.push(`editor_url=${editorUrl}`);

    if (isLoginUrl(page.url())) {
      return {
        status: "login_required",
        platform: "zhihu",
        mode: "real",
        reason: "Zhihu login is required. Open the Zhihu login window first.",
        currentUrl: page.url(),
        diagnostics
      };
    }

    await waitForEditor(page, diagnostics);

    const titleFilled = await fillFirst(page, [
      "textarea[placeholder*='标题']",
      "input[placeholder*='标题']",
      "[class*='Title'] textarea",
      "[class*='title'] textarea",
      "textarea.Input",
      "textarea",
      "input[type='text']"
    ], title.slice(0, 100));
    diagnostics.push(titleFilled ? "title_filled" : "title_missing");

    const zhihuBody = [body, "", ...normalizeTags(tags).map((tag) => `#${tag}`)].join("\n").trim();
    const bodyFilled = await fillFirst(page, [
      ".DraftEditor-editorContainer [contenteditable='true']",
      ".public-DraftEditor-content",
      ".ProseMirror",
      ".ql-editor",
      "div[contenteditable='true']",
      "[role='textbox']",
      "textarea"
    ], zhihuBody.slice(0, 50_000));
    diagnostics.push(bodyFilled ? "body_filled" : "body_missing");

    if (!titleFilled || !bodyFilled) {
      diagnostics.push(...await collectDiagnostics(page));
      return {
        status: "manual_required",
        platform: "zhihu",
        mode: "real",
        reason: "Zhihu editor opened, but title or body could not be filled automatically. Please finish it manually in the kept-open browser page.",
        currentUrl: page.url(),
        diagnostics
      };
    }

    if (dryRun) {
      diagnostics.push("dry_run_publish_skipped");
      return {
        status: "draft_ready",
        platform: "zhihu",
        mode: "real",
        dryRun: true,
        currentUrl: page.url(),
        diagnostics,
        note: "Zhihu fields were filled successfully. Publish click was skipped because dryRun is enabled."
      };
    }

    const clicked = await clickButtonByText(page, ["发布", "提交", "下一步"]);
    if (!clicked) {
      diagnostics.push(...await collectDiagnostics(page));
      return {
        status: "manual_required",
        platform: "zhihu",
        mode: "real",
        reason: "Zhihu content was filled, but the publish button was not found. Please click publish manually in the kept-open browser page.",
        currentUrl: page.url(),
        diagnostics
      };
    }

    diagnostics.push("publish_clicked");
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: 12_000 }).catch(() => {});
    return {
      status: "success",
      platform: "zhihu",
      mode: "real",
      publishedAt: new Date().toISOString(),
      currentUrl: page.url(),
      diagnostics,
      note: "The publish action was clicked in Zhihu. Check the editor page for final review or confirmation state."
    };
  } catch (error) {
    return {
      status: "failed",
      platform: "zhihu",
      mode: "real",
      reason: error.message || "Zhihu publish automation failed.",
      currentUrl: page.url(),
      diagnostics
    };
  }
}

async function gotoEditor(page, diagnostics) {
  let lastError = null;
  for (const url of articleEditorUrls) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForNetworkIdle({ idleTime: 800, timeout: 12_000 }).catch(() => {});
      diagnostics.push(`tried=${url}`);
      if (page.url() !== "about:blank") {
        return page.url();
      }
    } catch (error) {
      lastError = error;
      diagnostics.push(`failed_url=${url}`);
    }
  }
  throw lastError || new Error("Zhihu editor did not open.");
}

async function waitForEditor(page, diagnostics) {
  try {
    await page.waitForSelector("textarea,input,div[contenteditable='true'],[role='textbox']", { timeout: 15_000, visible: true });
    diagnostics.push("editor_ready");
  } catch {
    diagnostics.push("editor_ready_timeout");
  }
}

async function fillFirst(page, selectors, text, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const scopes = [page, ...page.frames()];
    for (const selector of selectors) {
      for (const scope of scopes) {
        const element = await scope.$(selector).catch(() => null);
        if (!element) continue;
        const visible = await element.isIntersectingViewport().catch(() => true);
        if (!visible) continue;
        await fillElement(page, element, text);
        return true;
      }
    }
    await sleep(300);
  }
  return false;
}

async function fillElement(page, element, text) {
  await element.click({ clickCount: 3 }).catch(() => {});
  const filledByDom = await element.evaluate((node, value) => {
    const tagName = node.tagName?.toLowerCase();
    if (tagName === "input" || tagName === "textarea") {
      const prototype = tagName === "input" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      descriptor?.set?.call(node, value);
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    if (node.isContentEditable) {
      node.textContent = value;
      node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      return true;
    }
    return false;
  }, text).catch(() => false);

  if (filledByDom) return;
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(text, { delay: 2 });
}

async function clickButtonByText(page, labels) {
  const point = await page.evaluate((buttonLabels) => {
    const candidates = Array.from(document.querySelectorAll("button,[role='button'],.btn,[class*='button'],a,div,span"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = (element.textContent || "").replace(/\s+/g, "");
        const style = getComputedStyle(element);
        const disabled = element.disabled === true || element.getAttribute("aria-disabled") === "true" || style.pointerEvents === "none";
        return { element, rect, text, disabled };
      })
      .filter(({ rect, text, disabled }) => (
        text &&
        !disabled &&
        rect.width > 0 &&
        rect.height > 0 &&
        buttonLabels.some((label) => text === label || text.includes(label))
      ));

    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const exactA = buttonLabels.includes(a.text) ? 0 : 1;
      const exactB = buttonLabels.includes(b.text) ? 0 : 1;
      if (exactA !== exactB) return exactA - exactB;
      return a.text.length - b.text.length;
    });
    const target = candidates[0];
    target.element.scrollIntoView({ block: "center", inline: "center" });
    const rect = target.element.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  }, labels);

  if (!point) return false;
  await page.mouse.move(point.x, point.y);
  await sleep(80);
  await page.mouse.down();
  await sleep(80);
  await page.mouse.up();
  return true;
}

async function collectDiagnostics(page) {
  const diagnostics = [];
  mkdirSync(debugDir, { recursive: true });
  const screenshotPath = join(debugDir, `zhihu-editor-${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  diagnostics.push(`debug_screenshot=${screenshotPath}`);
  const text = await page.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 600)).catch(() => "");
  if (text) diagnostics.push(`page_text=${text}`);
  return diagnostics;
}

async function getOrCreateZhihuPage(browser) {
  const pages = await browser.pages();
  const reusable = pages.find((page) => /zhihu\.com/.test(page.url()));
  if (reusable) {
    await reusable.bringToFront().catch(() => {});
    return reusable;
  }
  return browser.newPage();
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map((tag) => String(tag).replace(/^#/, "").trim()).filter(Boolean).slice(0, 8);
}

function isLoginUrl(url) {
  return /signin|login|account\/unhuman/i.test(url);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveBrowserPath() {
  const candidates = [
    process.env.ZHIHU_BROWSER_PATH,
    process.env.BILIBILI_BROWSER_PATH,
    process.env.REDNOTE_BROWSER_PATH,
    join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    join(process.env.ProgramFiles || "", "Google", "Chrome", "Application", "chrome.exe"),
    join(process.env["ProgramFiles(x86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
    join(process.env.ProgramFiles || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    join(process.env["ProgramFiles(x86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe")
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

function buildBrowserLaunchError(error) {
  const message = error?.message || String(error);
  if (/EPERM|EACCES|spawn/i.test(message)) {
    return `Zhihu browser launch failed: current backend process cannot start Chrome/Edge. Restart backend outside the sandbox and set ZHIHU_BROWSER_PATH if needed. Original error: ${message}`;
  }
  return `Zhihu browser launch failed: ${message}`;
}
