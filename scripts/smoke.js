import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const requiredFiles = [
  "index.html",
  "manifest.webmanifest",
  "service-worker.js",
  "assets/icon.svg",
  "src/app.js",
  "src/core/adapters.js",
  "src/core/publisher.js",
  "src/core/templates.js",
  "src/core/strategy.js",
  "src/core/calendar.js",
  "src/core/reports.js",
  "src/core/markdown.js",
  "src/core/snapshots.js",
  "src/core/platform-presets.js",
  "src/core/rules.js",
  "backend/server.js",
  "backend/routes/wechat.js",
  "backend/routes/bilibili.js",
  "backend/routes/credentials.js",
  "backend/services/wechat-api.js",
  "backend/services/bilibili-browser.js",
  "backend/storage/credentials-store.js",
  "docs/architecture.md",
  "docs/demo-script.md",
  "docs/api-contract.md",
  "examples/workspace-sample.json",
  "README.md"
];

for (const file of requiredFiles) {
  readFileSync(join(root, file), "utf8");
}

const html = readFileSync(join(root, "index.html"), "utf8");
const app = readFileSync(join(root, "src/app.js"), "utf8");
const readme = readFileSync(join(root, "README.md"), "utf8");

assertIncludes(html, "platformChoices", "platform selection container");
assertIncludes(html, "manifest.webmanifest", "PWA manifest");
assertIncludes(html, "readinessGrid", "readiness dashboard");
assertIncludes(html, "templateSelect", "template selector");
assertIncludes(html, "wechatThumbMediaId", "WeChat thumb media field");
assertIncludes(html, "openBilibiliLogin", "Bilibili login button");
assertIncludes(html, "publishResults", "publish result panel");
assertIncludes(app, "adaptForPlatforms", "adapter workflow");
assertIncludes(app, "buildPublishingStrategy", "strategy workflow");
assertIncludes(app, "buildScheduleCalendar", "calendar export workflow");
assertIncludes(app, "buildReadinessCsv", "readiness csv export workflow");
assertIncludes(app, "parseMarkdownDraft", "markdown import workflow");
assertIncludes(app, "createSnapshot", "snapshot workflow");
assertIncludes(app, "exportPlatformPreset", "platform preset workflow");
assertIncludes(app, "buildPlatformRulesMarkdown", "platform rules export workflow");
assertIncludes(app, "openBilibiliLogin", "Bilibili login workflow");
assertIncludes(app, "mode === \"real\"", "real publish log marker");
assertIncludes(app, "renderPublishResults", "visible publish result workflow");
assertIncludes(readme, "npm start", "startup command");
assertIncludes(readme, "npm test", "test command");
assertIncludes(readme, "thumb_media_id", "WeChat real publish prerequisite");

console.log("ok - smoke checks passed");

function assertIncludes(content, expected, label) {
  if (!content.includes(expected)) {
    throw new Error(`Missing ${label}: ${expected}`);
  }
}
