export const platformOrder = ["wechat", "zhihu", "bilibili", "rednote"];

export const platformMeta = {
  wechat: {
    displayName: "公众号",
    limits: { titleMax: 64, tagMax: 8, bodyMin: 120 },
    tone: "深度长文",
    publishMode: "图文草稿"
  },
  zhihu: {
    displayName: "知乎",
    limits: { titleMax: 50, tagMax: 5, bodyMin: 90 },
    tone: "观点问答",
    publishMode: "回答/文章"
  },
  bilibili: {
    displayName: "B站",
    limits: { titleMax: 80, tagMax: 10, bodyMin: 50 },
    tone: "视频简介",
    publishMode: "视频稿件",
    requiresCover: true
  },
  rednote: {
    displayName: "小红书",
    limits: { titleMax: 20, tagMax: 10, bodyMin: 40 },
    tone: "种草笔记",
    publishMode: "图文笔记",
    requiresCover: true
  }
};

export function normalizeContent(input = {}) {
  return {
    title: cleanText(input.title),
    body: cleanBody(input.body),
    tags: normalizeTags(input.tags),
    coverUrl: cleanText(input.coverUrl),
    scheduleAt: cleanText(input.scheduleAt),
    audience: cleanText(input.audience),
    voice: cleanText(input.voice),
    cta: cleanText(input.cta),
    authorNote: cleanText(input.authorNote)
  };
}

export function sanitizeCustomPlatforms(customPlatforms = []) {
  return customPlatforms
    .map((item) => ({
      key: cleanText(item.key).toLowerCase().replace(/[^a-z0-9_-]/g, ""),
      displayName: cleanText(item.displayName),
      tone: cleanText(item.tone) || "自定义风格",
      publishMode: cleanText(item.publishMode) || "自定义发布",
      limits: {
        titleMax: toPositiveNumber(item.limits?.titleMax, 60),
        tagMax: toPositiveNumber(item.limits?.tagMax, 8),
        bodyMin: toPositiveNumber(item.limits?.bodyMin, 60)
      },
      requiresCover: Boolean(item.requiresCover)
    }))
    .filter((item) => item.key && item.displayName && !platformMeta[item.key]);
}

export function getPlatformRegistry(customPlatforms = []) {
  const customMeta = {};
  const customAdapters = {};
  const customOrder = [];

  sanitizeCustomPlatforms(customPlatforms).forEach((platform) => {
    customOrder.push(platform.key);
    customMeta[platform.key] = {
      displayName: platform.displayName,
      limits: platform.limits,
      tone: platform.tone,
      publishMode: platform.publishMode,
      requiresCover: platform.requiresCover
    };
    customAdapters[platform.key] = (source) => adaptGenericPlatform(source, platform);
  });

  return {
    order: [...platformOrder, ...customOrder],
    meta: { ...platformMeta, ...customMeta },
    adapters: { ...builtInAdapters, ...customAdapters }
  };
}

export function adaptForPlatforms(input, platformKeys = platformOrder, customPlatforms = []) {
  const source = normalizeContent(input);
  return platformKeys.map((platform) => adaptForPlatform(source, platform, customPlatforms));
}

export function adaptForPlatform(sourceInput, platform, customPlatforms = []) {
  const source = normalizeContent(sourceInput);
  const registry = getPlatformRegistry(customPlatforms);
  const adapter = registry.adapters[platform];
  if (!adapter) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const content = adapter(source);
  const meta = registry.meta[platform];

  return {
    ...content,
    platform,
    displayName: meta.displayName,
    tone: meta.tone,
    publishMode: meta.publishMode,
    scheduleAt: source.scheduleAt,
    titleOptions: buildTitleOptions(content.title, source, meta.limits.titleMax),
    aiPrompt: buildAiPrompt(source, meta, content),
    validation: validateAdaptedContent(platform, content, customPlatforms)
  };
}

export function validateAdaptedContent(platform, content, customPlatforms = []) {
  const meta = getPlatformRegistry(customPlatforms).meta[platform];
  if (!meta) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const issues = [];
  if (!content.title) {
    issues.push({ level: "error", message: "标题不能为空" });
  }
  if (!content.body) {
    issues.push({ level: "error", message: "正文不能为空" });
  }
  if (content.title.length > meta.limits.titleMax) {
    issues.push({ level: "warning", message: `标题超过 ${meta.limits.titleMax} 字` });
  }
  if (content.body.length < meta.limits.bodyMin) {
    issues.push({ level: "warning", message: `正文少于 ${meta.limits.bodyMin} 字，建议补充内容` });
  }
  if (content.tags.length > meta.limits.tagMax) {
    issues.push({ level: "warning", message: `标签超过 ${meta.limits.tagMax} 个` });
  }
  if (!content.tags.length) {
    issues.push({ level: "warning", message: "建议至少添加 1 个标签" });
  }
  if (!content.coverUrl && meta.requiresCover) {
    issues.push({ level: "warning", message: "该平台建议补充封面图" });
  }

  return {
    ok: !issues.some((issue) => issue.level === "error"),
    issues
  };
}

export function scoreSourceContent(input) {
  const source = normalizeContent(input);
  const suggestions = [];
  let score = 100;

  if (source.title.length < 8) {
    score -= 15;
    suggestions.push("标题偏短，建议补充明确场景或收益点。");
  }
  if (source.title.length > 60) {
    score -= 10;
    suggestions.push("标题较长，适配短内容平台时可能需要精简。");
  }
  if (source.body.length < 160) {
    score -= 20;
    suggestions.push("正文素材偏少，自动适配后的平台差异会不够明显。");
  }
  if (source.tags.length < 2) {
    score -= 12;
    suggestions.push("标签较少，建议补充主题、场景、目标用户等标签。");
  }
  if (!source.coverUrl) {
    score -= 8;
    suggestions.push("B站和小红书更依赖封面，建议补充封面图地址或后续上传封面。");
  }
  if (!/[。！？!?]/.test(source.body)) {
    score -= 8;
    suggestions.push("正文缺少句子分隔，可能影响自动分段和要点提取。");
  }
  if (!source.audience) {
    score -= 6;
    suggestions.push("建议补充目标受众，平台适配会更贴近真实读者。");
  }
  if (!source.scheduleAt) {
    suggestions.push("可设置计划发布时间，用于演示排期发布能力。");
  }
  if (!source.cta) {
    suggestions.push("可加入行动引导，例如关注、评论、收藏或领取资料。");
  }

  return {
    score: Math.max(0, score),
    suggestions: suggestions.length ? suggestions : ["内容完整度较好，可以直接生成多平台版本。"]
  };
}

const builtInAdapters = {
  wechat(source) {
    const title = source.title || "一篇值得收藏的内容创作复盘";
    const body = [
      `导语：${summarize(source.body, 92)}`,
      "",
      "## 为什么值得关注",
      ensureParagraph(source.body),
      "",
      "## 可以直接复用的方法",
      buildBulletList(source.body, 4),
      "",
      "## 发布前检查",
      "- 标题是否表达清楚核心价值",
      "- 摘要是否能帮助读者快速判断是否继续阅读",
      "- 标签是否覆盖主题、场景和目标人群",
      "",
      "## 结语",
      "多平台发布的重点不是机械复制，而是保持核心观点一致，同时让表达方式适配平台语境。",
      source.cta ? "" : "",
      source.cta ? `行动建议：${source.cta}` : ""
    ].filter((line) => line !== undefined).join("\n");

    return {
      title: clamp(title, 64),
      body,
      tags: source.tags.slice(0, 8),
      coverUrl: source.coverUrl,
      summary: summarize(source.body, 110)
    };
  },

  zhihu(source) {
    const title = toQuestionTitle(source.title);
    const body = [
      "我的结论是：多平台发布的关键不是简单复制，而是把同一观点改写成适合平台语境的表达。",
      "",
      "### 先看问题本质",
      ensureParagraph(source.body),
      "",
      "### 我会这样拆解",
      buildNumberedList(source.body, 4),
      "",
      "### 实操建议",
      "先沉淀一份原始内容，再围绕平台限制生成不同标题、摘要、标签和正文结构。这样可以减少重复排版，也能让内容更贴近平台用户预期。",
      "",
      "### 最后",
      "当格式、标签、摘要和平台限制都能自动处理时，创作者的注意力才能回到内容本身。",
      source.cta ? "" : "",
      source.cta ? `如果这个方法对你有帮助，${source.cta}` : ""
    ].filter((line) => line !== undefined).join("\n");

    return {
      title: clamp(title, 50),
      body,
      tags: source.tags.slice(0, 5),
      coverUrl: source.coverUrl,
      summary: "适合知乎的观点式回答，强调问题、判断和推理过程。"
    };
  },

  bilibili(source) {
    const body = [
      `本期主题：${source.title || "多平台内容发布效率提升"}`,
      "",
      "视频简介：",
      summarize(source.body, 140),
      "",
      "看完你会了解：",
      buildNumberedList(source.body, 3),
      "",
      "时间线：",
      "00:00 创作者多平台发布痛点",
      "01:20 内容输入与平台选择",
      "02:40 自动适配与校验",
      "04:10 一键模拟发布",
      "05:20 扩展更多平台的架构",
      "",
      source.cta ? `互动引导：${source.cta}` : "互动引导：欢迎在评论区交流你的多平台发布流程。",
      "",
      `相关标签：${formatHashtags(source.tags, "#")}`
    ].join("\n");

    return {
      title: clamp(`【效率工具】${source.title || "多平台内容发布实践"}`, 80),
      body,
      tags: source.tags.slice(0, 10),
      coverUrl: source.coverUrl,
      summary: "适合 B站 的视频简介、看点和时间线结构。"
    };
  },

  rednote(source) {
    const title = clamp(makeRednoteTitle(source.title), 20);
    const body = [
      `${title}`,
      "",
      "今天分享一个提升内容发布效率的小方法：",
      shortLines(source.body),
      "",
      "适合这些场景：",
      "1. 一篇内容要发多个平台",
      "2. 每个平台都要改标题和标签",
      "3. 想减少复制粘贴和反复排版",
      "",
      "我的建议：先写一份原始内容，再用平台适配规则生成不同版本。",
      "",
      source.cta ? `${source.cta}` : "收藏起来，下次发布前直接照着检查。",
      "",
      formatHashtags(source.tags, "#")
    ].join("\n");

    return {
      title,
      body,
      tags: source.tags.slice(0, 10),
      coverUrl: source.coverUrl,
      summary: "适合小红书的短句、场景化和话题标签表达。"
    };
  }
};

function adaptGenericPlatform(source, platform) {
  const title = clamp(source.title || `${platform.displayName} 内容发布草稿`, platform.limits.titleMax);
  const body = [
    `${platform.displayName} 版本`,
    "",
    `目标受众：${source.audience || "当前平台用户"}`,
    `表达风格：${source.voice || platform.tone}`,
    "",
    "核心内容：",
    ensureParagraph(source.body),
    "",
    "发布要点：",
    buildBulletList(source.body, 4),
    "",
    source.cta ? `行动引导：${source.cta}` : "行动引导：欢迎互动、收藏或转发。",
    "",
    formatHashtags(source.tags, "#")
  ].join("\n");

  return {
    title,
    body,
    tags: source.tags.slice(0, platform.limits.tagMax),
    coverUrl: source.coverUrl,
    summary: `按 ${platform.displayName} 的 ${platform.tone} 风格生成的自定义平台文案。`
  };
}

function cleanText(value) {
  return String(value || "").trim();
}

function cleanBody(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return unique(tags.map(cleanText).filter(Boolean));
  }
  return unique(
    String(tags || "")
      .split(/[,，\s#]+/)
      .map(cleanText)
      .filter(Boolean)
  );
}

function unique(items) {
  return [...new Set(items)];
}

function summarize(body, maxLength) {
  const text = cleanBody(body).replace(/\n+/g, " ");
  if (!text) {
    return "围绕内容创作、平台适配和发布效率，提炼可执行的方法。";
  }
  return clamp(text, maxLength);
}

function clamp(text, maxLength) {
  const value = cleanText(text);
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function ensureParagraph(body) {
  return summarize(body, 360);
}

function splitSentences(body) {
  const text = cleanBody(body);
  const parts = text.split(/[。！？!?；;\n]+/).map(cleanText).filter(Boolean);
  return parts.length ? parts : ["明确目标平台", "提炼核心观点", "按平台规则重新组织内容"];
}

function buildBulletList(body, count) {
  return splitSentences(body)
    .slice(0, count)
    .map((item) => `- ${clamp(item, 76)}`)
    .join("\n");
}

function buildNumberedList(body, count) {
  return splitSentences(body)
    .slice(0, count)
    .map((item, index) => `${index + 1}. ${clamp(item, 76)}`)
    .join("\n");
}

function toQuestionTitle(title) {
  const value = cleanText(title);
  if (!value) {
    return "如何高效完成多平台内容发布？";
  }
  if (/[?？]$/.test(value)) {
    return value;
  }
  return `${value}，应该怎么理解和落地？`;
}

function makeRednoteTitle(title) {
  const value = cleanText(title) || "多平台发布效率提升";
  if (value.length <= 14) {
    return `${value}｜实用技巧`;
  }
  return value;
}

function shortLines(body) {
  return splitSentences(body)
    .slice(0, 5)
    .map((item) => `- ${clamp(item, 34)}`)
    .join("\n");
}

function formatHashtags(tags, prefix) {
  const normalized = normalizeTags(tags);
  if (!normalized.length) {
    return `${prefix}内容创作 ${prefix}效率工具 ${prefix}多平台发布`;
  }
  return normalized.map((tag) => `${prefix}${tag.replace(/^#/, "")}`).join(" ");
}

function toPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function buildTitleOptions(title, source, maxLength) {
  const base = cleanText(title) || cleanText(source.title) || "多平台内容发布效率提升";
  return unique([
    clamp(base, maxLength),
    clamp(`${base}：给创作者的实用流程`, maxLength),
    clamp(`如何把${base.replace(/[?？]/g, "")}落地？`, maxLength)
  ]);
}

function buildAiPrompt(source, meta, content) {
  return [
    `请将下面内容改写为适合「${meta.displayName}」发布的版本。`,
    `平台风格：${meta.tone}。`,
    `发布类型：${meta.publishMode}。`,
    `标题不超过 ${meta.limits.titleMax} 字，标签不超过 ${meta.limits.tagMax} 个。`,
    source.audience ? `目标受众：${source.audience}。` : "",
    source.voice ? `品牌语气：${source.voice}。` : "",
    source.cta ? `行动引导：${source.cta}。` : "",
    "",
    "请输出：",
    "1. 3 个标题备选",
    "2. 适配后的正文",
    "3. 标签列表",
    "4. 发布前检查提醒",
    "",
    `参考标题：${content.title}`,
    "原始内容：",
    source.body || "暂无正文"
  ].filter(Boolean).join("\n");
}
