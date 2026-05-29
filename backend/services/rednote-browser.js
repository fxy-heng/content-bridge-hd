import puppeteer from "puppeteer";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const profileDir = join(__dirname, "..", "data", "rednote-profile");
const assetDir = join(__dirname, "..", "data", "rednote-assets");
const loginUrl = "https://creator.xiaohongshu.com/login";
const homeUrl = "https://creator.xiaohongshu.com/";
const publishUrls = [
  "https://creator.xiaohongshu.com/publish/imgNote",
  "https://creator.xiaohongshu.com/publish/publish"
];

let browserInstance = null;

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
  const page = await browser.newPage();
  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
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
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 10_000 }).catch(() => {});
    const currentUrl = page.url();
    return {
      loggedIn: !isLoginUrl(currentUrl),
      currentUrl,
      profileDir
    };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function publishNote({ title, body, tags = [], coverUrl = "" }) {
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
    const uploaded = await uploadFirstFileInput(page, imagePath);
    diagnostics.push(uploaded ? "image_uploaded" : "image_upload_input_missing");

    const titleFilled = await fillFirst(page, [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      '[class*="title"] input',
      '[class*="title"] textarea',
      "input[type='text']",
      "textarea"
    ], title.slice(0, 20));
    diagnostics.push(titleFilled ? "title_filled" : "title_missing");

    const noteBody = [body, "", ...normalizeTags(tags).map((tag) => `#${tag}`)].join("\n").trim();
    const bodyFilled = await fillFirst(page, [
      'textarea[placeholder*="正文"]',
      'textarea[placeholder*="描述"]',
      'textarea[placeholder*="分享"]',
      'div[contenteditable="true"]',
      ".ql-editor",
      ".ProseMirror",
      '[role="textbox"]',
      "textarea"
    ], noteBody.slice(0, 1000));
    diagnostics.push(bodyFilled ? "body_filled" : "body_missing");

    if (!uploaded || !titleFilled || !bodyFilled) {
      return {
        status: "manual_required",
        platform: "rednote",
        mode: "real",
        reason: "RedNote editor opened, but one or more fields could not be filled automatically. Please finish the note manually in the kept-open browser page.",
        currentUrl: page.url(),
        diagnostics
      };
    }

    const clicked = await clickButtonByText(page, ["发布", "提交", "立即发布"]);
    if (!clicked) {
      return {
        status: "manual_required",
        platform: "rednote",
        mode: "real",
        reason: "RedNote note content was filled, but the publish button was not found. Please click publish manually in the kept-open browser page.",
        currentUrl: page.url(),
        diagnostics
      };
    }

    diagnostics.push("publish_clicked");
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: 15_000 }).catch(() => {});
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

async function uploadFirstFileInput(page, imagePath) {
  const scopes = [page, ...page.frames()];
  for (const scope of scopes) {
    const input = await scope.$('input[type="file"]').catch(() => null);
    if (input) {
      await input.uploadFile(imagePath);
      return true;
    }
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
    if (!target) return false;
    target.click();
    return true;
  }, labels);
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
