import puppeteer from "puppeteer";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const profileDir = join(__dirname, "..", "data", "rednote-profile");
const assetDir = join(__dirname, "..", "data", "rednote-assets");
const debugDir = join(__dirname, "..", "data", "rednote-debug");
const loginUrl = "https://creator.xiaohongshu.com/login";
const homeUrl = "https://creator.xiaohongshu.com/";
const publishUrls = [
  "https://creator.xiaohongshu.com/publish/imgNote",
  "https://creator.xiaohongshu.com/publish/publish"
];

let browserInstance = null;
let rednoteLoginCache = {
  checkedAt: 0,
  status: null
};

async function getBrowser() {
  if (browserInstance?.isConnected()) {
    return browserInstance;
  }

  mkdirSync(profileDir, { recursive: true });
  browserInstance = await puppeteer.launch({
    headless: process.env.REDNOTE_HEADLESS === "1" ? "new" : false,
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
  }).catch((error) => {
    throw new Error(buildBrowserLaunchError(error));
  });

  return browserInstance;
}

export async function openLoginPage() {
  const browser = await getBrowser();
  const page = await getOrCreateRednotePage(browser);
  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  rednoteLoginCache = { checkedAt: 0, status: null };
  return {
    ok: true,
    platform: "rednote",
    status: "login_required",
    loginUrl,
    profileDir,
    message: "Login in the opened RedNote Creator Platform window, then refresh status."
  };
}

export async function checkLoginStatus() {
  if (rednoteLoginCache.status && Date.now() - rednoteLoginCache.checkedAt < 10_000) {
    return {
      ...rednoteLoginCache.status,
      cached: true
    };
  }

  const browser = await getBrowser();
  const page = await getOrCreateRednotePage(browser);
  try {
    if (!page.url().startsWith(homeUrl)) {
      await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    }
    await waitForLoginSignal(page);
    const currentUrl = page.url();
    const status = {
      loggedIn: !isLoginUrl(currentUrl),
      currentUrl,
      profileDir
    };
    rednoteLoginCache = {
      checkedAt: Date.now(),
      status
    };
    return status;
  } finally {
    // Keep the page open so the next status check can reuse the logged-in tab quickly.
  }
}

export async function publishNote({ title, body, tags = [], coverUrl = "", dryRun = false }) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const diagnostics = [];

  try {
    const currentUrl = await gotoPublisher(page, diagnostics);
    diagnostics.push(`publisher_url=${currentUrl}`);

    if (isLoginUrl(page.url())) {
      return {
        status: "login_required",
        platform: "rednote",
        mode: "real",
        reason: "RedNote login is required. Open the login window and finish login first.",
        currentUrl: page.url(),
        diagnostics
      };
    }

    const imagePath = coverUrl ? await downloadImage(coverUrl, diagnostics) : createDefaultCover(title);
    await ensureImageNoteMode(page, diagnostics);
    const uploaded = await uploadImageForRednote(page, imagePath, diagnostics);
    diagnostics.push(uploaded ? "image_uploaded" : "image_upload_input_missing");
    if (uploaded) {
      await waitForEditorAfterUpload(page, diagnostics);
    }

    const titleFilled = await fillFirst(page, [
      "#title-textarea",
      'textarea#title-textarea',
      'input#title-textarea',
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      '[placeholder*="填写标题"]',
      '[class*="title"] input',
      '[class*="title"] textarea',
      "input[type='text']",
      "textarea"
    ], title.slice(0, 20));
    diagnostics.push(titleFilled ? "title_filled" : "title_missing");

    const noteBody = [body, "", ...normalizeTags(tags).map((tag) => `#${tag}`)].join("\n").trim();
    const bodyFilled = await fillFirst(page, [
      "#post-textarea",
      'textarea#post-textarea',
      'textarea[placeholder*="正文"]',
      'textarea[placeholder*="描述"]',
      'textarea[placeholder*="分享"]',
      '[placeholder*="添加正文"]',
      ".tiptap.ProseMirror",
      'div[contenteditable="true"]',
      '[contenteditable="plaintext-only"]',
      ".ql-editor",
      ".ProseMirror",
      '[role="textbox"]',
      "textarea"
    ], noteBody.slice(0, 1000));
    diagnostics.push(bodyFilled ? "body_filled" : "body_missing");

    if (!uploaded || !titleFilled || !bodyFilled) {
      diagnostics.push(...await collectEditorDiagnostics(page));
      return {
        status: "manual_required",
        platform: "rednote",
        mode: "real",
        reason: "RedNote editor opened, but one or more fields could not be filled automatically. Please finish the note manually in the kept-open browser page.",
        currentUrl: page.url(),
        diagnostics
      };
    }

    if (dryRun) {
      diagnostics.push("dry_run_publish_skipped");
      return {
        status: "draft_ready",
        platform: "rednote",
        mode: "real",
        dryRun: true,
        currentUrl: page.url(),
        diagnostics,
        note: "RedNote fields were filled successfully. Publish click was skipped because dryRun is enabled."
      };
    }

    const publishResult = await publishAndVerify(page, diagnostics);
    if (publishResult.status !== "success") {
      diagnostics.push(...await collectEditorDiagnostics(page));
      return {
        status: "manual_required",
        platform: "rednote",
        mode: "real",
        reason: publishResult.reason,
        currentUrl: page.url(),
        diagnostics
      };
    }

    return {
      status: "success",
      platform: "rednote",
      mode: "real",
      publishedAt: new Date().toISOString(),
      currentUrl: page.url(),
      diagnostics,
      note: "The publish action was clicked in RedNote Creator Platform. Check the creator platform for final review status."
    };
  } catch (error) {
    return {
      status: "failed",
      platform: "rednote",
      mode: "real",
      reason: error.message || "RedNote publish automation failed.",
      currentUrl: page.url(),
      diagnostics
    };
  }
}

async function gotoPublisher(page, diagnostics) {
  let lastError = null;
  for (const url of publishUrls) {
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
  throw lastError || new Error("RedNote publisher did not open.");
}

async function ensureImageNoteMode(page, diagnostics) {
  const clickedTab = await clickElementByText(page, ["上传图文"], {
    maxY: 180,
    preferShortest: true
  });
  diagnostics.push(clickedTab.clicked ? "image_note_tab_clicked" : "image_note_tab_not_found");
  await sleep(800);
}

async function getOrCreateRednotePage(browser) {
  const pages = await browser.pages();
  const reusable = pages.find((page) => /creator\.xiaohongshu\.com/.test(page.url()));
  if (reusable) {
    await reusable.bringToFront().catch(() => {});
    return reusable;
  }
  return browser.newPage();
}

async function waitForLoginSignal(page) {
  await Promise.race([
    page.waitForFunction(() => !/login|passport|signin/i.test(location.href), { timeout: 5_000 }),
    page.waitForFunction(() => document.body?.innerText?.includes("笔记管理"), { timeout: 5_000 }),
    sleep(3_000)
  ]).catch(() => {});
}

async function waitForEditorAfterUpload(page, diagnostics) {
  const editorSelectors = [
    "#title-textarea",
    "#post-textarea",
    '[placeholder*="标题"]',
    '[placeholder*="正文"]',
    ".tiptap.ProseMirror",
    '[contenteditable="true"]',
    '[role="textbox"]'
  ];

  const selector = editorSelectors.join(",");
  try {
    await page.waitForSelector(selector, { timeout: 15_000, visible: true });
    diagnostics.push("editor_ready");
  } catch {
    diagnostics.push("editor_ready_timeout");
  }

  await page.waitForNetworkIdle({ idleTime: 800, timeout: 8_000 }).catch(() => {});
}

async function fillFirst(page, selectors, text, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const scopes = [page, ...page.frames()];
    for (const selector of selectors) {
      for (const scope of scopes) {
        const element = await scope.$(selector).catch(() => null);
        if (!element) {
          continue;
        }
        const visible = await element.isIntersectingViewport().catch(() => true);
        if (!visible) {
          continue;
        }
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

  if (filledByDom) {
    return;
  }

  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(text, { delay: 5 });
}

async function revealPublishControls(page) {
  await page.evaluate(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
  }).catch(() => {});
  await sleep(500);
}

async function publishAndVerify(page, diagnostics) {
  let sawPublishButton = false;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await revealPublishControls(page);
    const clickResult = await clickButtonByText(page, ["立即发布", "发布笔记", "发布", "提交"], 18_000);
    if (!clickResult.clicked) {
      diagnostics.push(`publish_button_missing_attempt_${attempt}=${clickResult.reason || "not_found"}`);
      break;
    }

    sawPublishButton = true;
    diagnostics.push(`publish_clicked_attempt_${attempt}=${clickResult.text || "unknown"}`);
    await sleep(1_200);

    const confirmResult = await clickElementByText(page, ["确认发布", "确认", "确定", "我知道了"], {
      minY: 0,
      preferShortest: true,
      selectors: ["button", "[role='button']", ".btn", "[class*='button']", "div", "span"],
      skipDisabled: true,
      timeout: 3_000
    });
    diagnostics.push(confirmResult.clicked ? `confirm_clicked_attempt_${attempt}=${confirmResult.text || "unknown"}` : `confirm_not_required_attempt_${attempt}`);

    const verified = await waitForPublishSuccessSignal(page, diagnostics, 6_000);
    if (verified) {
      return { status: "success" };
    }

    const stillHasPublish = await hasClickableText(page, ["立即发布", "发布", "提交"], {
      minY: 220,
      selectors: ["button", "[role='button']", ".btn", "[class*='button']", "[class*='submit']", "[class*='publish']", "div", "span"]
    });
    diagnostics.push(stillHasPublish ? `publish_button_still_visible_attempt_${attempt}` : `publish_button_not_visible_attempt_${attempt}`);
    if (!stillHasPublish) {
      break;
    }
  }

  return {
    status: "manual_required",
    reason: sawPublishButton
      ? "RedNote publish button was clicked, but the page did not show a verifiable success signal. Please confirm any pending dialog or final review state in the kept-open browser page."
      : "RedNote note content was filled, but the publish button was not found or was disabled. Please click publish manually in the kept-open browser page."
  };
}

async function uploadImageForRednote(page, imagePath, diagnostics) {
  const chooserOpened = await uploadViaFileChooser(page, imagePath, diagnostics);
  if (chooserOpened) {
    return true;
  }
  return uploadFirstFileInput(page, imagePath);
}

async function uploadViaFileChooser(page, imagePath, diagnostics) {
  try {
    const chooserPromise = page.waitForFileChooser({ timeout: 5_000 });
    const clicked = await clickElementByText(page, ["上传图片"], {
      maxY: 700,
      preferShortest: true
    });
    if (!clicked.clicked) {
      chooserPromise.catch(() => {});
      diagnostics.push("upload_button_not_found");
      return false;
    }
    const chooser = await chooserPromise;
    await chooser.accept([imagePath]);
    diagnostics.push("file_chooser_upload");
    return true;
  } catch (error) {
    diagnostics.push(`file_chooser_upload_failed=${error.message}`);
    return false;
  }
}

async function uploadFirstFileInput(page, imagePath) {
  const scopes = [page, ...page.frames()];
  for (const scope of scopes) {
    const input = await scope.$('input[type="file"]').catch(() => null);
    if (input) {
      await input.uploadFile(imagePath);
      await input.evaluate((element) => {
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }).catch(() => {});
      return true;
    }
  }
  return false;
}

async function collectEditorDiagnostics(page) {
  const diagnostics = [];
  mkdirSync(debugDir, { recursive: true });
  const screenshotPath = join(debugDir, `rednote-editor-${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  diagnostics.push(`debug_screenshot=${screenshotPath}`);

  for (const [frameIndex, frame] of page.frames().entries()) {
    const frameDiagnostics = await frame.evaluate(() => {
      const controls = Array.from(document.querySelectorAll("input,textarea,[contenteditable],[role='textbox']"))
        .slice(0, 20)
        .map((element, index) => {
          const rect = element.getBoundingClientRect();
          const label = [
            `control_${index}`,
            element.tagName?.toLowerCase(),
            element.id ? `#${element.id}` : "",
            element.className ? `.${String(element.className).trim().replace(/\s+/g, ".").slice(0, 80)}` : "",
            element.getAttribute("placeholder") ? `placeholder=${element.getAttribute("placeholder")}` : "",
            element.getAttribute("contenteditable") ? `contenteditable=${element.getAttribute("contenteditable")}` : "",
            `visible=${rect.width > 0 && rect.height > 0}`
          ].filter(Boolean);
          return label.join("|");
        });
      const buttons = Array.from(document.querySelectorAll("button,[role='button'],.btn,[class*='button']"))
        .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 20);
      const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 500);
      return { controls, buttons, bodyText };
    }).catch((error) => ({ controls: [], buttons: [], bodyText: `frame_diagnostics_failed=${error.message}` }));

    diagnostics.push(`frame_${frameIndex}_url=${frame.url()}`);
    diagnostics.push(frameDiagnostics.controls.length ? `frame_${frameIndex}_controls=${frameDiagnostics.controls.join(" || ")}` : `frame_${frameIndex}_controls_missing`);
    diagnostics.push(frameDiagnostics.buttons.length ? `frame_${frameIndex}_buttons=${frameDiagnostics.buttons.join(" | ")}` : `frame_${frameIndex}_buttons_missing`);
    if (frameDiagnostics.bodyText) {
      diagnostics.push(`frame_${frameIndex}_text=${frameDiagnostics.bodyText}`);
    }
  }

  return diagnostics;
}

async function waitForPublishSuccessSignal(page, diagnostics, timeout = 12_000) {
  try {
    await page.waitForFunction(() => {
      const text = (document.body?.innerText || "").replace(/\s+/g, "");
      return [
        "发布成功",
        "提交成功",
        "发布成功啦",
        "审核中",
        "等待审核",
        "已提交审核"
      ].some((signal) => text.includes(signal)) || /\/publish\/success|\/posts|\/note\/manage|\/manage\/note/i.test(location.href);
    }, { timeout });
    diagnostics.push("publish_verified");
    return true;
  } catch {
    const snapshot = await page.evaluate(() => ({
      url: location.href,
      text: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 400)
    })).catch(() => ({ url: page.url(), text: "" }));
    diagnostics.push(`publish_unverified_url=${snapshot.url}`);
    if (snapshot.text) {
      diagnostics.push(`publish_unverified_text=${snapshot.text}`);
    }
    return false;
  }
}

async function hasClickableText(page, labels, options = {}) {
  return page.evaluate(({ buttonLabels, minY = 0, maxY = Number.POSITIVE_INFINITY, selectors }) => {
    const selectorText = (selectors || ["button", "[role='button']", ".btn", "[class*='button']", "div", "span"]).join(",");
    return Array.from(document.querySelectorAll(selectorText)).some((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const text = (element.textContent || "").replace(/\s+/g, "");
      const className = String(element.className || "");
      const disabled = (
        element.disabled === true ||
        element.getAttribute("aria-disabled") === "true" ||
        element.getAttribute("disabled") !== null ||
        /disabled|disable|forbid|inactive/i.test(className) ||
        style.pointerEvents === "none" ||
        Number(style.opacity) < 0.45
      );
      return (
        text &&
        !disabled &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top >= minY &&
        rect.top <= maxY &&
        buttonLabels.some((label) => text === label || text.includes(label))
      );
    });
  }, { buttonLabels: labels, ...options }).catch(() => false);
}

async function clickButtonByText(page, labels, timeout = 0) {
  return clickElementByText(page, labels, {
    minY: 220,
    preferShortest: true,
    selectors: [
      "button",
      "[role='button']",
      ".btn",
      "[class*='button']",
      "[class*='submit']",
      "[class*='publish']",
      "div",
      "span"
    ],
    skipDisabled: true,
    timeout
  });
}

async function clickElementByText(page, labels, options = {}) {
  const timeout = options.timeout || 0;
  const deadline = Date.now() + timeout;
  let lastResult = { clicked: false, reason: "not_found" };

  do {
    lastResult = await page.evaluate(({ buttonLabels, minY = 0, maxY = Number.POSITIVE_INFINITY, preferShortest = false, selectors, skipDisabled = false }) => {
      const selectorText = (selectors || [
        "button",
        "[role='button']",
        ".btn",
        "[class*='button']",
        "a",
        "div",
        "span",
        "li"
      ]).join(",");

      const candidates = Array.from(document.querySelectorAll(selectorText))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const text = (element.textContent || "").replace(/\s+/g, "");
          const className = String(element.className || "");
          const disabled = (
            element.disabled === true ||
            element.getAttribute("aria-disabled") === "true" ||
            element.getAttribute("disabled") !== null ||
            /disabled|disable|forbid|inactive/i.test(className) ||
            style.pointerEvents === "none" ||
            Number(style.opacity) < 0.45
          );
          return { element, rect, text, disabled };
        })
        .filter(({ rect, text, disabled }) => (
          text &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.top >= 0 &&
          rect.top >= minY &&
          rect.top <= maxY &&
          (!skipDisabled || !disabled) &&
          buttonLabels.some((label) => text === label || text.includes(label))
        ));

      if (!candidates.length) return { clicked: false, reason: "not_found" };
      candidates.sort((a, b) => {
        const exactA = buttonLabels.includes(a.text) ? 0 : 1;
        const exactB = buttonLabels.includes(b.text) ? 0 : 1;
        if (exactA !== exactB) return exactA - exactB;
        if (preferShortest && a.text.length !== b.text.length) {
          return a.text.length - b.text.length;
        }
        return b.rect.top - a.rect.top;
      });
      const target = candidates[0];
      target.element.scrollIntoView({ block: "center", inline: "center" });
      target.element.click();
      return {
        clicked: true,
        text: target.text,
        top: Math.round(target.rect.top)
      };
    }, { buttonLabels: labels, ...options });

    if (lastResult.clicked || timeout <= 0) {
      return lastResult;
    }
    await sleep(500);
  } while (Date.now() < deadline);

  return lastResult;
}

async function downloadImage(url, diagnostics) {
  try {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("not_http");
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const extension = contentType.includes("png") ? "png" : "jpg";
    mkdirSync(assetDir, { recursive: true });
    const filePath = join(assetDir, `cover-${Date.now()}.${extension}`);
    writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
    diagnostics.push("cover_downloaded");
    return filePath;
  } catch (error) {
    diagnostics.push(`cover_download_failed=${error.message}`);
    return createDefaultCover("ContentBridge");
  }
}

function createDefaultCover(title) {
  mkdirSync(assetDir, { recursive: true });
  const filePath = join(assetDir, `generated-cover-${Date.now()}.png`);
  writeFileSync(filePath, createDefaultCoverPng(title));
  return filePath;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map((tag) => String(tag).replace(/^#/, "").trim()).filter(Boolean).slice(0, 8);
}

function isLoginUrl(url) {
  return /login|passport|signin/i.test(url);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveBrowserPath() {
  const candidates = [
    process.env.REDNOTE_BROWSER_PATH,
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
    return `RedNote browser launch failed: current backend process cannot start Chrome/Edge. Restart backend outside the sandbox and set REDNOTE_BROWSER_PATH if needed. Original error: ${message}`;
  }
  return `RedNote browser launch failed: ${message}`;
}

function createDefaultCoverPng(title) {
  const width = 900;
  const height = 1200;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const hash = [...String(title || "ContentBridge")].reduce((sum, char) => (sum + char.charCodeAt(0)) % 80, 0);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * 3;
      raw[offset] = 214 + ((x + hash) % 24);
      raw[offset + 1] = 76 + ((y + hash) % 34);
      raw[offset + 2] = 82 + ((x + y + hash) % 28);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", Buffer.concat([uint32(width), uint32(height), Buffer.from([8, 2, 0, 0, 0])])),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  return Buffer.concat([uint32(data.length), typeBuffer, data, uint32(crc32(Buffer.concat([typeBuffer, data])))]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
