export const platformOrder = ["wechat", "zhihu", "bilibili", "rednote"];

export const platformMeta = {
  wechat: {
    displayName: "公众号",
    limits: { titleMax: 64, tagMax: 8, bodyMin: 80 },
    tone: "深度长文"
  },
  zhihu: {
    displayName: "知乎",
    limits: { titleMax: 50, tagMax: 5, bodyMin: 60 },
    tone: "观点问答"
  },
  bilibili: {
    displayName: "B站",
    limits: { titleMax: 80, tagMax: 10, bodyMin: 40 },
    tone: "视频简介"
  },
  rednote: {
    displayName: "小红书",
    limits: { titleMax: 20, tagMax: 10, bodyMin: 30 },
    tone: "种草笔记"
  }
};

export function normalizeContent(input) {
  return {
    title: cleanText(input.title),
    body: cleanBody(input.body),
    tags: normalizeTags(input.tags),
    coverUrl: cleanText(input.coverUrl),
    authorNote: cleanText(input.authorNote)
  };
}

export function adaptForPlatforms(input, platformKeys = platformOrder) {
  const source = normalizeContent(input);
  return platformKeys.map((platform) => adaptForPlatform(source, platform));
}

export function adaptForPlatform(source, platform) {
  const adapter = adapters[platform];
  if (!adapter) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const content = adapter(source);
  return {
    ...content,
    platform,
    displayName: platformMeta[platform].displayName,
    tone: platformMeta[platform].tone,
    validation: validateAdaptedContent(platform, content)
  };
}

export function validateAdaptedContent(platform, content) {
  const meta = platformMeta[platform];
  if (!meta) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const issues = [];
  if (!content.title) {
    issues.push({ level: "error", message: "标题不能为空" });
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
  if (!content.coverUrl && (platform === "bilibili" || platform === "rednote")) {
    issues.push({ level: "warning", message: "该平台建议补充封面图" });
  }

  return {
    ok: !issues.some((issue) => issue.level === "error"),
    issues
  };
}

const adapters = {
  wechat(source) {
    const title = source.title || "一篇值得收藏的内容创作复盘";
    const intro = `导语：${summarize(source.body, 86)}`;
    const body = [
      intro,
      "",
      "## 为什么值得关注",
      ensureParagraph(source.body),
      "",
      "## 可以直接复用的方法",
      buildBulletList(source.body, 4),
      "",
      "## 结语",
      "如果你也在做多平台内容发布，可以先从统一选题、统一素材、分平台表达开始，把重复劳动变成可复用流程。"
    ].join("\n");

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
      buildNumberedList(source.body, 3),
      "",
      "### 最后",
      "当格式、标签、摘要和平台限制都能自动处理时，创作者的注意力才能回到内容本身。"
    ].join("\n");

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
      summarize(source.body, 130),
      "",
      "时间线：",
      "00:00 主题背景",
      "01:20 核心流程演示",
      "03:40 平台适配效果",
      "05:10 发布与日志",
      "",
      `相关标签：${formatHashtags(source.tags, "#")}`
    ].join("\n");

    return {
      title: clamp(`【效率工具】${source.title || "多平台内容发布实践"}`, 80),
      body,
      tags: source.tags.slice(0, 10),
      coverUrl: source.coverUrl,
      summary: "适合 B站 的视频简介和时间线结构。"
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
    return tags.map(cleanText).filter(Boolean);
  }
  return String(tags || "")
    .split(/[,，\s#]+/)
    .map(cleanText)
    .filter(Boolean);
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
  return summarize(body, 320);
}

function splitSentences(body) {
  const text = cleanBody(body);
  const parts = text.split(/[。！？!?；;\n]+/).map(cleanText).filter(Boolean);
  return parts.length ? parts : ["明确目标平台", "提炼核心观点", "按平台规则重新组织内容"];
}

function buildBulletList(body, count) {
  return splitSentences(body)
    .slice(0, count)
    .map((item) => `- ${clamp(item, 68)}`)
    .join("\n");
}

function buildNumberedList(body, count) {
  return splitSentences(body)
    .slice(0, count)
    .map((item, index) => `${index + 1}. ${clamp(item, 72)}`)
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
  if (value.length <= 16) {
    return `${value}｜实用技巧`;
  }
  return value;
}

function shortLines(body) {
  return splitSentences(body)
    .slice(0, 5)
    .map((item) => `- ${clamp(item, 32)}`)
    .join("\n");
}

function formatHashtags(tags, prefix) {
  const normalized = normalizeTags(tags);
  if (!normalized.length) {
    return `${prefix}内容创作 ${prefix}效率工具 ${prefix}多平台发布`;
  }
  return normalized.map((tag) => `${prefix}${tag.replace(/^#/, "")}`).join(" ");
}

