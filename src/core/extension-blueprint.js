export const extensionLevels = [
  {
    key: "config",
    name: "配置扩展",
    summary: "在页面添加平台规则，立即参与适配、校验、预览、导出和模拟发布。",
    files: ["src/core/adapters.js", "src/core/platform-presets.js", "src/core/rules.js"]
  },
  {
    key: "adapter",
    name: "适配器扩展",
    summary: "为平台编写专属改写逻辑、标题策略、提示词和测试，适合长期维护的平台。",
    files: ["src/core/adapters.js", "test/adapters.test.js", "README.md"]
  },
  {
    key: "publisher",
    name: "发布器扩展",
    summary: "接入官方 API 或浏览器自动化，按统一发布结果返回真实状态与失败原因。",
    files: ["src/core/publisher.js", "backend/routes", "backend/services", "docs/api-contract.md"]
  }
];

export const platformPresetSuggestions = [
  {
    key: "douyin",
    displayName: "抖音",
    tone: "短视频口播",
    publishMode: "短视频文案",
    limits: { titleMax: 30, tagMax: 6, bodyMin: 50 },
    requiresCover: true
  },
  {
    key: "toutiao",
    displayName: "今日头条",
    tone: "信息流长图文",
    publishMode: "图文文章",
    limits: { titleMax: 60, tagMax: 8, bodyMin: 120 },
    requiresCover: true
  },
  {
    key: "kuaishou",
    displayName: "快手",
    tone: "短句种草口播",
    publishMode: "短视频简介",
    limits: { titleMax: 40, tagMax: 8, bodyMin: 40 },
    requiresCover: true
  }
];

export function buildExtensionReadiness(customPlatforms = []) {
  const customCount = customPlatforms.length;
  return {
    customCount,
    levels: extensionLevels.map((level, index) => ({
      ...level,
      status: index === 0 && customCount > 0 ? "active" : index === 0 ? "ready" : "planned"
    })),
    nextSuggestion: customCount
      ? "已有自定义平台。下一步可为高频平台沉淀内置适配器，并补充真实发布后端。"
      : "可先从配置扩展开始，添加抖音、今日头条等平台规则验证工作流。"
  };
}
