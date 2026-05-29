import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const requiredFiles = [
  "index.html",
  "src/app.js",
  "src/core/adapters.js",
  "src/core/publisher.js",
  "src/core/templates.js",
  "src/core/strategy.js",
  "docs/architecture.md",
  "docs/demo-script.md",
  "README.md"
];

for (const file of requiredFiles) {
  readFileSync(join(root, file), "utf8");
}

const html = readFileSync(join(root, "index.html"), "utf8");
const app = readFileSync(join(root, "src/app.js"), "utf8");
const readme = readFileSync(join(root, "README.md"), "utf8");

assertIncludes(html, "platformChoices", "platform selection container");
assertIncludes(html, "readinessGrid", "readiness dashboard");
assertIncludes(html, "templateSelect", "template selector");
assertIncludes(app, "adaptForPlatforms", "adapter workflow");
assertIncludes(app, "buildPublishingStrategy", "strategy workflow");
assertIncludes(readme, "npm start", "startup command");
assertIncludes(readme, "npm test", "test command");

console.log("ok - smoke checks passed");

function assertIncludes(content, expected, label) {
  if (!content.includes(expected)) {
    throw new Error(`Missing ${label}: ${expected}`);
  }
}
