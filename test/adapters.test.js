import assert from "node:assert/strict";
import {
  adaptForPlatform,
  adaptForPlatforms,
  getPlatformRegistry,
  sanitizeCustomPlatforms,
  scoreSourceContent,
  validateAdaptedContent
} from "../src/core/adapters.js";
import { buildScheduleCalendar, countScheduledItems } from "../src/core/calendar.js";
import { publishToPlatforms } from "../src/core/publisher.js";
import { buildPublishingStrategy } from "../src/core/strategy.js";
import { contentTemplates, getTemplate } from "../src/core/templates.js";

const source = {
  title: "AI 工具如何提升多平台内容发布效率",
  body: "很多创作者需要把同一篇内容发布到不同平台。平台之间存在标题长度、标签风格、正文结构和发布限制差异。自动适配可以减少重复排版，让创作者把更多时间放在内容质量上。这个工具还可以沉淀发布日志和排期信息。",
  tags: "AI工具,内容创作,效率,多平台发布",
  coverUrl: ""
};

const customPlatforms = [
  {
    key: "douyin",
    displayName: "抖音",
    tone: "短视频口播",
    publishMode: "短视频文案",
    limits: { titleMax: 30, tagMax: 6, bodyMin: 50 },
    requiresCover: true
  }
];

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("adapts one source content for all default platforms", () => {
  const results = adaptForPlatforms(source);

  assert.equal(results.length, 4);
  assert.deepEqual(
    results.map((item) => item.platform),
    ["wechat", "zhihu", "bilibili", "rednote"]
  );
  assert.ok(results.every((item) => item.title.length > 0));
  assert.ok(results.every((item) => item.body.includes("平台") || item.body.includes("内容")));
});

test("keeps platform-specific title limits", () => {
  const rednote = adaptForPlatform(source, "rednote");
  const zhihu = adaptForPlatform(source, "zhihu");

  assert.ok(rednote.title.length <= 20);
  assert.ok(zhihu.title.length <= 50);
});

test("registers and adapts custom platforms", () => {
  const registry = getPlatformRegistry(customPlatforms);
  const result = adaptForPlatform(source, "douyin", customPlatforms);

  assert.ok(registry.order.includes("douyin"));
  assert.equal(result.displayName, "抖音");
  assert.ok(result.title.length <= 30);
  assert.ok(result.body.includes("抖音 版本"));
});

test("sanitizes invalid custom platforms", () => {
  const result = sanitizeCustomPlatforms([
    { key: "wechat", displayName: "重复平台" },
    { key: " bad key !! ", displayName: "" },
    { key: "toutiao", displayName: "今日头条", limits: { titleMax: "70" } }
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].key, "toutiao");
  assert.equal(result[0].limits.titleMax, 70);
});

test("validates empty titles and bodies as errors", () => {
  const result = validateAdaptedContent("wechat", {
    title: "",
    body: "",
    tags: [],
    coverUrl: ""
  });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.message === "标题不能为空"));
  assert.ok(result.issues.some((issue) => issue.message === "正文不能为空"));
});

test("scores source content with actionable suggestions", () => {
  const result = scoreSourceContent({
    title: "短",
    body: "素材少",
    tags: "",
    coverUrl: ""
  });

  assert.ok(result.score < 80);
  assert.ok(result.suggestions.length >= 3);
});

test("builds title options and ai prompts for adapted content", () => {
  const result = adaptForPlatform(
    {
      ...source,
      audience: "内容创作者",
      voice: "专业克制",
      cta: "欢迎收藏"
    },
    "wechat"
  );

  assert.ok(result.titleOptions.length >= 2);
  assert.ok(result.aiPrompt.includes("公众号"));
  assert.ok(result.aiPrompt.includes("目标受众：内容创作者"));
});

test("provides reusable source content templates", () => {
  const template = getTemplate("tutorial");

  assert.ok(contentTemplates.length >= 3);
  assert.equal(template.key, "tutorial");
  assert.ok(template.body.includes("第一步"));
});

test("builds publishing strategy from adapted readiness", () => {
  const adapted = adaptForPlatforms(source, ["wechat", "zhihu"]);
  const strategy = buildPublishingStrategy(source, adapted);

  assert.equal(strategy.primaryPlatform, "公众号");
  assert.ok(strategy.recommendations.length >= 3);
});

test("exports scheduled platforms as calendar events", () => {
  const adapted = adaptForPlatforms(
    {
      ...source,
      scheduleAt: "2026-05-30T10:00"
    },
    ["wechat", "zhihu"]
  );
  const calendar = buildScheduleCalendar(adapted, {
    now: new Date("2026-05-29T00:00:00.000Z")
  });

  assert.equal(countScheduledItems(adapted), 2);
  assert.ok(calendar.includes("BEGIN:VCALENDAR"));
  assert.ok(calendar.includes("SUMMARY:公众号 发布"));
});

test("simulated publisher returns publish results", async () => {
  const adapted = adaptForPlatforms(source, ["wechat", "zhihu"]);
  const results = await publishToPlatforms(adapted, {
    now: new Date("2026-05-29T00:00:00.000Z")
  });

  assert.equal(results.length, 2);
  assert.ok(results.every((item) => item.status === "success"));
  assert.equal(results[0].displayName, "公众号");
});

test("simulated publisher supports future scheduled publishing", async () => {
  const adapted = adaptForPlatforms(
    {
      ...source,
      scheduleAt: "2026-05-30T10:00"
    },
    ["wechat"]
  );
  const results = await publishToPlatforms(adapted, {
    now: new Date("2026-05-29T00:00:00.000Z")
  });

  assert.equal(results[0].status, "scheduled");
  assert.equal(results[0].reason, "已进入模拟排期队列");
});

test("simulated publisher marks validation errors as failed", async () => {
  const results = await publishToPlatforms([
    {
      platform: "wechat",
      displayName: "公众号",
      title: "",
      validation: { issues: [{ level: "error", message: "标题不能为空" }] }
    }
  ]);

  assert.equal(results[0].status, "failed");
  assert.equal(results[0].reason, "标题不能为空");
});

for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}
