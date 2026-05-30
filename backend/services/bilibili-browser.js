import puppeteer from "puppeteer";
import { existsSync, mkdirSync } from "node:fs";
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
  try {
    browserInstance = await puppeteer.launch({
      headless: process.env.BILIBILI_HEADLESS === "1" ? "new" : false,
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
      '[class*="title"] input',
      '[class*="title"] textarea',
      '[class*="Title"] input',
      '[class*="Title"] textarea',
      'input[maxlength="80"]',
      'input[type="text"]',
      "textarea"
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

    const beforePublish = await inspectPublishState(page);
    diagnostics.push(`publish_candidates=${beforePublish.candidates.length}`);

    const clickResult = await submitPublishFlow(page, beforePublish);
    if (!clickResult.clicked) {
      return {
        status: "manual_required",
        platform: "bilibili",
        mode: "real",
        reason: "Content was filled in Bilibili, but the publish button was not found. Please click publish manually in the kept-open browser page.",
        currentUrl: page.url(),
        diagnostics
      };
    }

    diagnostics.push(`publish_clicked=${clickResult.clicks.map((item) => item.text).join(">")}`);
    const afterPublish = clickResult.afterPublish;
    diagnostics.push(`after_url=${afterPublish.url}`);
    if (!isPublishConfirmed(beforePublish, afterPublish)) {
      return {
        status: "manual_required",
        platform: "bilibili",
        mode: "real",
        reason: "B站发布按钮已点击，但页面仍停留在编辑器或未出现提交成功状态。请检查是否需要补充必填项、二次确认或处理平台校验。",
        currentUrl: page.url(),
        diagnostics,
        detail: { beforePublish, afterPublish }
      };
    }

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

async function submitPublishFlow(page, beforePublish) {
  const clicks = [];
  let afterPublish = beforePublish;
  const labelRounds = [
    ["发布", "立即发布", "提交"],
    ["确定", "确认", "确认发布", "立即发布", "提交"]
  ];

  for (const labels of labelRounds) {
    const clicked = await clickButtonByText(page, labels, { allowDialog: clicks.length > 0 });
    if (!clicked) {
      continue;
    }

    clicks.push(clicked);
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: 15_000 }).catch(() => {});
    await sleep(800);
    afterPublish = await inspectPublishState(page);

    if (isPublishConfirmed(beforePublish, afterPublish)) {
      return { clicked: true, clicks, afterPublish };
    }
  }

  return { clicked: clicks.length > 0, clicks, afterPublish };
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
  const scopes = [page, ...page.frames()];
  for (const selector of selectors) {
    for (const scope of scopes) {
      const element = await scope.$(selector).catch(() => null);
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
  }
  return false;
}

async function clickButtonByText(page, labels, options = {}) {
  const point = await page.evaluate((buttonLabels, clickOptions) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const hasDialog = Boolean(document.querySelector('[role="dialog"], .modal, [class*="modal"], [class*="dialog"], [class*="Dialog"]'));
    const candidates = Array.from(document.querySelectorAll("button,[role='button'],.btn,[class*='button'],div,span"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = (element.textContent || "").replace(/\s+/g, "");
        const style = getComputedStyle(element);
        const disabled = element.disabled === true || element.getAttribute("aria-disabled") === "true" || style.pointerEvents === "none";
        const visible = style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
        const bottomAction = rect.top > viewport.height * 0.58 || /fixed|sticky/.test(style.position);
        const dialogAction = clickOptions.allowDialog && hasDialog && rect.top > viewport.height * 0.25;
        const blueLike = /rgba?\(\s*(0|[1-9]\d|1[0-2]\d)\s*,\s*(80|[9-9]\d|1[0-6]\d)\s*,\s*(1[5-9]\d|2[0-5]\d)/.test(style.backgroundColor) || /primary|submit|publish/i.test(String(element.className));
        return { element, rect, text, disabled, visible, bottomAction, dialogAction, blueLike };
      })
      .filter(({ rect, text, disabled, visible, bottomAction, dialogAction }) => (
        text &&
        visible &&
        !disabled &&
        rect.width >= 40 &&
        rect.height >= 24 &&
        (bottomAction || dialogAction) &&
        buttonLabels.some((label) => text === label || text.includes(label))
      ));

    if (!candidates.length) {
      return false;
    }

    candidates.sort((a, b) => {
      const exactA = buttonLabels.includes(a.text) ? 0 : 1;
      const exactB = buttonLabels.includes(b.text) ? 0 : 1;
      if (exactA !== exactB) return exactA - exactB;
      if (a.blueLike !== b.blueLike) return a.blueLike ? -1 : 1;
      return b.rect.top - a.rect.top;
    });

    const target = candidates[0];
    target.element.scrollIntoView({ block: "center", inline: "center" });
    const rect = target.element.getBoundingClientRect();
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      text: target.text,
      className: String(target.element.className || "").slice(0, 80)
    };
  }, labels, options);

  if (!point) return false;
  await page.mouse.move(point.x, point.y);
  await sleep(80);
  await page.mouse.down();
  await sleep(100);
  await page.mouse.up();
  return point;
}

async function inspectPublishState(page) {
  return page.evaluate(() => {
    const pageText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const candidates = Array.from(document.querySelectorAll("button,[role='button'],.btn,[class*='button'],div,span"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = (element.textContent || "").replace(/\s+/g, "");
        const style = getComputedStyle(element);
        if (!text || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        if (!/发布|提交|立即发布|完成|确定/.test(text)) {
          return null;
        }
        return {
          tag: element.tagName,
          text: text.slice(0, 40),
          className: String(element.className || "").slice(0, 80),
          rect: {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          backgroundColor: style.backgroundColor,
          disabled: element.disabled === true || element.getAttribute("aria-disabled") === "true",
          bottomLike: rect.top > viewport.height * 0.58 || /fixed|sticky/.test(style.position)
        };
      })
      .filter(Boolean)
      .slice(0, 20);
    return {
      url: window.location.href,
      title: document.title,
      hasSuccessText: /发布成功|提交成功|审核中|已提交|稿件管理|内容管理/.test(pageText),
      stillEditor: /read-editor|upload\/text\/edit/.test(window.location.href),
      pageText: pageText.slice(0, 500),
      candidates
    };
  });
}

function isPublishConfirmed(beforePublish, afterPublish) {
  if (afterPublish.hasSuccessText) {
    return true;
  }
  if (afterPublish.url !== beforePublish.url && !afterPublish.stillEditor) {
    return true;
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function resolveBrowserPath() {
  const candidates = [
    process.env.BILIBILI_BROWSER_PATH,
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
    return [
      "B站登录浏览器启动失败：当前后端进程没有权限启动 Chrome/Edge。",
      "处理方式：关闭当前后端，在普通 PowerShell 或 CMD 中运行 `cd /d F:\\研1\\vibe实践\\content-bridge\\backend && node server.js`；",
      "如果仍失败，请设置环境变量 BILIBILI_BROWSER_PATH 指向本机 chrome.exe。",
      `原始错误：${message}`
    ].join(" ");
  }
  return `B站登录浏览器启动失败：${message}`;
}
