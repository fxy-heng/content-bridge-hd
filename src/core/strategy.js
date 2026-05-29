import { normalizeContent } from "./adapters.js";

export function buildPublishingStrategy(input, adaptedItems = []) {
  const source = normalizeContent(input);
  const recommendations = [];

  if (source.scheduleAt) {
    recommendations.push(`已设置计划发布时间：${source.scheduleAt}，适合演示排期发布。`);
  } else {
    recommendations.push("建议为重点平台设置计划发布时间，便于形成稳定发布节奏。");
  }

  if (adaptedItems.some((item) => item.platform === "wechat")) {
    recommendations.push("公众号版本适合沉淀完整方法论，可作为主内容源。");
  }
  if (adaptedItems.some((item) => item.platform === "zhihu")) {
    recommendations.push("知乎版本适合强化问题意识和观点表达，建议标题使用问句。");
  }
  if (adaptedItems.some((item) => item.platform === "bilibili")) {
    recommendations.push("B站版本建议搭配视频封面和时间线，降低观众理解成本。");
  }
  if (adaptedItems.some((item) => item.platform === "rednote")) {
    recommendations.push("小红书版本建议保留短句、场景和话题标签，增强收藏动机。");
  }

  const blocked = adaptedItems.filter((item) => !item.validation.ok);
  const warnings = adaptedItems.filter((item) => item.validation.ok && item.validation.issues.length);
  if (blocked.length) {
    recommendations.unshift(`当前有 ${blocked.length} 个平台存在阻塞错误，应先修复标题或正文。`);
  } else if (warnings.length) {
    recommendations.unshift(`当前有 ${warnings.length} 个平台存在优化项，可发布但建议先处理。`);
  } else if (adaptedItems.length) {
    recommendations.unshift("所有目标平台均已通过校验，可以进入发布或排期。");
  }

  return {
    primaryPlatform: choosePrimaryPlatform(adaptedItems),
    recommendations
  };
}

function choosePrimaryPlatform(adaptedItems) {
  if (!adaptedItems.length) {
    return "未选择平台";
  }
  const withoutErrors = adaptedItems.filter((item) => item.validation.ok);
  const candidates = withoutErrors.length ? withoutErrors : adaptedItems;
  const priority = ["wechat", "zhihu", "bilibili", "rednote"];
  const selected = priority.map((key) => candidates.find((item) => item.platform === key)).find(Boolean) || candidates[0];
  return selected.displayName;
}
