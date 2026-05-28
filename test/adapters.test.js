import assert from "node:assert/strict";
import { adaptForPlatform, adaptForPlatforms, validateAdaptedContent } from "../src/core/adapters.js";
import { publishToPlatforms } from "../src/core/publisher.js";

const source = {
  title: "AI 工具如何提升多平台内容发布效率",
  body: "很多创作者需要把同一篇内容发布到不同平台。平台之间存在标题长度、标签风格、正文结构和发布限制差异。自动适配可以减少重复排版，让创作者把更多时间放在内容质量上。",
  tags: "AI工具,内容创作,效率,多平台发布",
  coverUrl: ""
};

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

test("validates empty titles as errors", () => {
  const result = validateAdaptedContent("wechat", {
    title: "",
    body: "这是一段足够长的正文内容，用于验证标题为空时应该返回错误。",
    tags: [],
    coverUrl: ""
  });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.level === "error"));
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
