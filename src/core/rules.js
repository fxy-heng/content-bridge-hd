import { getPlatformRegistry } from "./adapters.js";

export function buildPlatformRulesMarkdown(customPlatforms = []) {
  const registry = getPlatformRegistry(customPlatforms);
  const lines = [
    "# ContentBridge 平台规则说明",
    "",
    "| 平台 | 风格 | 发布类型 | 标题上限 | 标签上限 | 正文建议 | 封面建议 |",
    "| --- | --- | --- | ---: | ---: | ---: | --- |"
  ];

  registry.order.forEach((key) => {
    const meta = registry.meta[key];
    lines.push(
      `| ${meta.displayName} | ${meta.tone} | ${meta.publishMode} | ${meta.limits.titleMax} | ${meta.limits.tagMax} | ${meta.limits.bodyMin} | ${meta.requiresCover ? "是" : "否"} |`
    );
  });

  lines.push(
    "",
    "## 扩展方式",
    "",
    "新增平台时需要定义平台 Key、名称、风格、发布类型、标题上限、标签上限、正文建议长度和封面建议。",
    "这些配置会进入统一的适配、校验、导出和模拟发布流程。"
  );

  return lines.join("\n");
}
