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

    const bodyState = await inspectBodyState(page);
    diagnostics.push(`body_chars=${bodyState.charCount}`);

    if (!titleFilled || !bodyFilled || !bodyState.ok) {
      diagnostics.push(...await collectDiagnostics(page));
      return {
        status: "manual_required",
        platform: "zhihu",
        mode: "real",
        reason: bodyState.ok
          ? "Zhihu editor opened, but title or body could not be filled automatically. Please finish it manually in the kept-open browser page."
          : "知乎正文看起来已填入，但编辑器内部字数仍为 0，自动化已停止发布以避免假成功。请检查编辑器模式或手动输入任意字符触发知乎状态。",
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

    const beforePublish = await inspectPublishState(page);
    diagnostics.push(`publish_candidates=${beforePublish.candidates.length}`);
    diagnostics.push(...summarizePublishCandidates(beforePublish));
    const publishResult = await submitZhihuPublishFlow(page, beforePublish);
    if (!publishResult.clicked) {
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

    diagnostics.push(`publish_clicked=${publishResult.clicks.map((item) => item.text || item.source || "unknown").join(">")}`);
    const afterPublish = publishResult.afterPublish;
    diagnostics.push(`after_url=${afterPublish.url}`);
    if (!isPublishConfirmed(beforePublish, afterPublish)) {
      diagnostics.push(...await collectDiagnostics(page));
      return {
        status: "manual_required",
        platform: "zhihu",
        mode: "real",
        reason: "知乎发布按钮已点击，但页面没有出现发布成功、提交审核或离开编辑器的状态。请检查是否还有二次确认、必填项或平台校验。",
        currentUrl: page.url(),
        diagnostics,
        detail: { beforePublish, afterPublish }
      };
    }

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

async function submitZhihuPublishFlow(page, beforePublish) {
  const clicks = [];
  let afterPublish = beforePublish;
  const rounds = [
    () => clickZhihuPublishButton(page),
    () => clickButtonByText(page, ["确认发布", "继续发布", "发布", "提交", "确定", "我知道了"], { preferDialog: true }),
    () => clickButtonByText(page, ["确认发布", "继续发布", "发布", "提交", "确定"], { preferDialog: true })
  ];

  for (const click of rounds) {
    const point = await click();
    if (!point) {
      continue;
    }

    clicks.push(point);
    afterPublish = await waitForPublishTransition(page, beforePublish);
    if (isPublishConfirmed(beforePublish, afterPublish)) {
      return { clicked: true, clicks, afterPublish };
    }
  }

  return { clicked: clicks.length > 0, clicks, afterPublish };
}

async function waitForPublishTransition(page, beforePublish) {
  const deadline = Date.now() + 15_000;
  let latest = beforePublish;

  while (Date.now() < deadline) {
    await Promise.race([
      page.waitForNetworkIdle({ idleTime: 800, timeout: 2_500 }).catch(() => {}),
      sleep(1_000)
    ]);
    latest = await inspectPublishState(page);
    if (isPublishConfirmed(beforePublish, latest) || latest.hasDialog) {
      return latest;
    }
  }

  return latest;
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

  const isRichEditor = await element.evaluate((node) => {
    return Boolean(
      node.isContentEditable ||
      node.matches?.("[contenteditable]:not([contenteditable='false'])") ||
      node.closest?.("[contenteditable]:not([contenteditable='false'])")
    );
  }).catch(() => false);

  if (isRichEditor) {
    return fillRichEditor(page, element, text);
  }

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
    return false;
  }, text).catch(() => false);

  if (filledByDom) return true;
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(text, { delay: 2 });
  return true;
}

async function fillRichEditor(page, element, text) {
  await element.evaluate((node) => {
    const editable = node.matches?.("[contenteditable]:not([contenteditable='false'])")
      ? node
      : node.querySelector?.("[contenteditable]:not([contenteditable='false'])") || node.closest?.("[contenteditable]:not([contenteditable='false'])") || node;
    if (!(editable instanceof HTMLElement)) return;
    editable.focus();
  }).catch(() => {});

  await element.click().catch(() => {});
  await sleep(200);
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await sleep(150);

  const insertedByCdp = await insertTextWithCdp(page, text);
  if (!insertedByCdp) {
    await page.keyboard.type(text, { delay: 1 });
  }

  await sleep(500);
  await page.keyboard.type(" ", { delay: 1 });
  await page.keyboard.press("Backspace");
  await sleep(300);
  return true;
}

async function insertTextWithCdp(page, text) {
  const client = await page.target().createCDPSession().catch(() => null);
  if (!client) return false;
  try {
    await client.send("Input.insertText", { text });
    return true;
  } catch {
    return false;
  } finally {
    await client.detach().catch(() => {});
  }
}

async function inspectPublishState(page) {
  return page.evaluate(() => {
    const pageText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const hasDialog = Boolean(document.querySelector('[role="dialog"], .Modal, .modal, [class*="Modal"], [class*="modal"], [class*="Dialog"], [class*="dialog"]'));
    const candidates = Array.from(document.querySelectorAll("button,[role='button'],.Button,.btn,[class*='button'],a,div,span"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = (element.textContent || "").replace(/\s+/g, "");
        const style = getComputedStyle(element);
        if (!text || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        if (!/发布|提交|下一步|完成|确定|审核/.test(text)) {
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
          disabled: element.disabled === true || element.getAttribute("aria-disabled") === "true",
          backgroundColor: style.backgroundColor
        };
      })
      .filter(Boolean)
      .slice(0, 20);
    return {
      url: window.location.href,
      title: document.title,
      hasSuccessText: /发布成功|提交成功|审核中|已发布|已提交|文章管理|内容管理/.test(pageText),
      hasDialog,
      stillEditor: /zhuanlan\.zhihu\.com\/write|\/p\/[^/]+\/edit|creator/.test(window.location.href),
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

async function inspectBodyState(page) {
  return page.evaluate(() => {
    const pageText = document.body?.innerText || "";
    const wordCounts = Array.from(pageText.matchAll(/字数[:：]\s*(\d+)/g))
      .map((match) => Number(match[1]))
      .filter(Number.isFinite);
    const editor = document.querySelector(".DraftEditor-editorContainer [contenteditable='true'], .public-DraftEditor-content, .ProseMirror, .ql-editor, div[contenteditable='true'], [role='textbox']");
    const editorText = (editor?.innerText || editor?.textContent || "").replace(/\s+/g, "");
    const charCount = Math.max(editorText.length, ...wordCounts, 0);
    return {
      ok: charCount > 0,
      charCount,
      editorTextLength: editorText.length,
      wordCounts
    };
  }).catch(() => ({ ok: false, charCount: 0, editorTextLength: 0 }));
}

async function clickButtonByText(page, labels, options = {}) {
  const point = await page.evaluate((buttonLabels, clickOptions) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const dialog = document.querySelector('[role="dialog"], .Modal, .modal, [class*="Modal"], [class*="modal"], [class*="Dialog"], [class*="dialog"]');
    const candidates = Array.from(document.querySelectorAll("button,[role='button'],.btn,[class*='button'],a,div,span"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = (element.textContent || "").replace(/\s+/g, "");
        const style = getComputedStyle(element);
        const disabled = element.disabled === true || element.getAttribute("aria-disabled") === "true" || style.pointerEvents === "none";
        const visible = style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
        const inDialog = dialog ? dialog.contains(element) : false;
        const bottomAction = rect.top > viewport.height * 0.72;
        const rightAction = rect.left > viewport.width * 0.5;
        const primaryLike = /primary|submit|publish|Blue/i.test(String(element.className)) ||
          /rgba?\(\s*(0|[1-8]\d)\s*,\s*(80|9\d|1[0-6]\d)\s*,\s*(160|1[7-9]\d|2[0-5]\d)/.test(style.backgroundColor);
        return { element, rect, text, disabled, visible, inDialog, bottomAction, rightAction, primaryLike };
      })
      .filter(({ rect, text, disabled, visible, inDialog, bottomAction, rightAction }) => (
        text &&
        visible &&
        !disabled &&
        rect.width >= 36 &&
        rect.height >= 24 &&
        (!clickOptions.preferDialog || inDialog || (bottomAction && rightAction)) &&
        buttonLabels.some((label) => text === label || text.includes(label))
      ));

    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const exactA = buttonLabels.includes(a.text) ? 0 : 1;
      const exactB = buttonLabels.includes(b.text) ? 0 : 1;
      if (exactA !== exactB) return exactA - exactB;
      if (a.inDialog !== b.inDialog) return a.inDialog ? -1 : 1;
      if (a.primaryLike !== b.primaryLike) return a.primaryLike ? -1 : 1;
      if (a.rightAction !== b.rightAction) return a.rightAction ? -1 : 1;
      return a.text.length - b.text.length;
    });
    const target = candidates[0];
    target.element.scrollIntoView({ block: "center", inline: "center" });
    const rect = target.element.getBoundingClientRect();
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      text: target.text,
      source: target.inDialog ? "dialog" : "page"
    };
  }, labels, options);

  if (!point) return false;
  await page.mouse.move(point.x, point.y);
  await sleep(80);
  await page.mouse.down();
  await sleep(80);
  await page.mouse.up();
  return point;
}

async function clickZhihuPublishButton(page) {
  const deadline = Date.now() + 25_000;
  let lastState = null;

  while (Date.now() < deadline) {
    await revealPublishControls(page);
    const state = await findZhihuPublishButton(page);
    lastState = state;
    if (state?.point) {
      return clickAtPoint(page, state.point);
    }

    await sleep(state?.saving ? 800 : 500);
  }

  if (lastState?.disabledPoint) {
    return clickAtPoint(page, { ...lastState.disabledPoint, forced: true });
  }

  return lastState?.point || false;
}

async function revealPublishControls(page) {
  await page.evaluate(() => {
    const publishSetting = Array.from(document.querySelectorAll("button,[role='button'],a,div,span"))
      .find((element) => (element.textContent || "").replace(/\s+/g, "").includes("发布设置"));
    if (publishSetting) {
      publishSetting.scrollIntoView({ block: "center", inline: "nearest" });
      return;
    }
    window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" });
  }).catch(() => {});
  await sleep(150);
}

async function clickAtPoint(page, point) {
  await page.mouse.move(point.x, point.y);
  await sleep(80);
  await page.mouse.down();
  await sleep(100);
  await page.mouse.up();
  return point;
}

async function findZhihuPublishButton(page) {
  return page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const pageText = (document.body?.innerText || "").replace(/\s+/g, " ");
    const saving = /草稿保存中|保存中/.test(pageText);
    const candidates = Array.from(document.querySelectorAll("button,[role='button'],.Button,.btn,[class*='button'],a,div,span"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = (element.textContent || "").replace(/\s+/g, "");
        const style = getComputedStyle(element);
        const disabled = element.disabled === true ||
          element.getAttribute("aria-disabled") === "true" ||
          element.getAttribute("disabled") !== null ||
          style.pointerEvents === "none" ||
          /disabled|is-disabled/i.test(String(element.className));
        const visible = style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
        const bottomBar = rect.top > viewport.height * 0.65;
        const rightSide = rect.left > viewport.width * 0.55;
        const blue = /rgba?\(\s*(0|1|2|3|4|5|6|7|8|9|[1-8]\d)\s*,\s*(80|9\d|1[0-5]\d)\s*,\s*(180|19\d|2[0-5]\d)/.test(style.backgroundColor);
        return { element, rect, text, style, disabled, visible, bottomBar, rightSide, blue };
      })
      .filter(({ rect, text, disabled, visible, bottomBar, rightSide }) => (
        visible &&
        bottomBar &&
        rightSide &&
        rect.width >= 44 &&
        rect.height >= 28 &&
        text.includes("发布") &&
        !text.includes("发布设置")
      ));

    if (!candidates.length) {
      const y = Math.round(viewport.height - 32);
      const scanXs = [
        Math.round(viewport.width * 0.68),
        Math.round(viewport.width * 0.72),
        Math.round(viewport.width * 0.76),
        Math.round(viewport.width * 0.80)
      ];
      for (const x of scanXs) {
        let element = document.elementFromPoint(x, y);
        for (let depth = 0; element && depth < 5; depth += 1, element = element.parentElement) {
          const rect = element.getBoundingClientRect();
          const text = (element.textContent || "").replace(/\s+/g, "");
          const style = getComputedStyle(element);
          const disabled = element.disabled === true ||
            element.getAttribute("aria-disabled") === "true" ||
            element.getAttribute("disabled") !== null ||
            style.pointerEvents === "none" ||
            /disabled|is-disabled/i.test(String(element.className));
          if (
            text === "发布" &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width >= 44 &&
            rect.height >= 28
          ) {
            if (disabled) {
              return {
                saving,
                disabled: true,
                text,
                source: "elementFromPoint",
                disabledPoint: {
                  x: Math.round(rect.left + rect.width / 2),
                  y: Math.round(rect.top + rect.height / 2),
                  text,
                  backgroundColor: style.backgroundColor,
                  source: "elementFromPoint-disabled"
                }
              };
            }
            return {
              saving,
              point: {
                x: Math.round(rect.left + rect.width / 2),
                y: Math.round(rect.top + rect.height / 2),
                text,
                backgroundColor: style.backgroundColor,
                source: "elementFromPoint"
              }
            };
          }
        }
      }
      return { saving, disabled: false, text: "" };
    }

    candidates.sort((a, b) => {
      const exactA = a.text === "发布" ? 0 : 1;
      const exactB = b.text === "发布" ? 0 : 1;
      if (exactA !== exactB) return exactA - exactB;
      if (a.blue !== b.blue) return a.blue ? -1 : 1;
      if (a.disabled !== b.disabled) return a.disabled ? 1 : -1;
      return b.rect.left - a.rect.left;
    });

    const target = candidates[0];
    target.element.scrollIntoView({ block: "center", inline: "center" });
    const refreshedRect = target.element.getBoundingClientRect();
    if (target.disabled) {
      return {
        saving,
        disabled: true,
        text: target.text,
        source: "query",
        disabledPoint: {
          x: Math.round(refreshedRect.left + refreshedRect.width / 2),
          y: Math.round(refreshedRect.top + refreshedRect.height / 2),
          text: target.text,
          backgroundColor: target.style.backgroundColor,
          source: "query-disabled"
        }
      };
    }

    const rect = refreshedRect;
    return {
      saving,
      point: {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        text: target.text,
        backgroundColor: target.style.backgroundColor,
        source: "query"
      }
    };
  });
}

function summarizePublishCandidates(state) {
  if (!state?.candidates?.length) {
    return [];
  }
  return state.candidates
    .slice(0, 8)
    .map((candidate, index) => {
      const rect = candidate.rect || {};
      return `publish_candidate_${index + 1}=${candidate.text}|${candidate.tag}|disabled=${Boolean(candidate.disabled)}|rect=${rect.left},${rect.top},${rect.width},${rect.height}`;
    });
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
