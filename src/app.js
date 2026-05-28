import {
  adaptForPlatforms,
  getPlatformRegistry,
  platformMeta,
  platformOrder,
  sanitizeCustomPlatforms,
  scoreSourceContent
} from "./core/adapters.js";
import { publishToPlatforms } from "./core/publisher.js";

const storageKeys = {
  logs: "contentBridge.logs",
  draft: "contentBridge.draft",
  customPlatforms: "contentBridge.customPlatforms"
};

const state = {
  adapted: [],
  logs: loadJson(storageKeys.logs, []),
  customPlatforms: sanitizeCustomPlatforms(loadJson(storageKeys.customPlatforms, []))
};

const elements = {
  title: document.querySelector("#sourceTitle"),
  body: document.querySelector("#sourceBody"),
  tags: document.querySelector("#sourceTags"),
  coverUrl: document.querySelector("#coverUrl"),
  scheduleAt: document.querySelector("#scheduleAt"),
  audience: document.querySelector("#audience"),
  voice: document.querySelector("#voice"),
  cta: document.querySelector("#cta"),
  platformChoices: document.querySelector("#platformChoices"),
  previewGrid: document.querySelector("#previewGrid"),
  summaryText: document.querySelector("#summaryText"),
  publishLog: document.querySelector("#publishLog"),
  platformCount: document.querySelector("#platformCount"),
  qualityScore: document.querySelector("#qualityScore"),
  logCount: document.querySelector("#logCount"),
  qualityHeadline: document.querySelector("#qualityHeadline"),
  qualityHint: document.querySelector("#qualityHint"),
  qualityList: document.querySelector("#qualityList"),
  adaptButton: document.querySelector("#adaptButton"),
  publishButton: document.querySelector("#publishButton"),
  exportButton: document.querySelector("#exportButton"),
  importButton: document.querySelector("#importButton"),
  importFile: document.querySelector("#importFile"),
  saveDraft: document.querySelector("#saveDraft"),
  loadSample: document.querySelector("#loadSample"),
  clearLog: document.querySelector("#clearLog"),
  addPlatform: document.querySelector("#addPlatform"),
  resetPlatforms: document.querySelector("#resetPlatforms"),
  customKey: document.querySelector("#customKey"),
  customName: document.querySelector("#customName"),
  customTitleMax: document.querySelector("#customTitleMax"),
  customTagMax: document.querySelector("#customTagMax"),
  customBodyMin: document.querySelector("#customBodyMin"),
  customTone: document.querySelector("#customTone"),
  customMode: document.querySelector("#customMode"),
  customCover: document.querySelector("#customCover")
};

elements.adaptButton.addEventListener("click", adaptCurrentContent);
elements.publishButton.addEventListener("click", publishCurrentContent);
elements.exportButton.addEventListener("click", exportWorkspace);
elements.importButton.addEventListener("click", () => elements.importFile.click());
elements.importFile.addEventListener("change", importWorkspace);
elements.saveDraft.addEventListener("click", saveDraft);
elements.loadSample.addEventListener("click", () => {
  loadSampleContent();
  adaptCurrentContent();
});
elements.clearLog.addEventListener("click", clearLogs);
elements.addPlatform.addEventListener("click", addCustomPlatform);
elements.resetPlatforms.addEventListener("click", resetCustomPlatforms);

sourceInputs().forEach((input) => {
  input.addEventListener("input", debounce(() => {
    autoSaveDraft();
    adaptCurrentContent();
  }, 250));
});

renderPlatformChoices();
restoreDraftOrSample();
adaptCurrentContent();
renderLogs();

function sourceInputs() {
  return [
    elements.title,
    elements.body,
    elements.tags,
    elements.coverUrl,
    elements.scheduleAt,
    elements.audience,
    elements.voice,
    elements.cta
  ];
}

function readSourceContent() {
  return {
    title: elements.title.value,
    body: elements.body.value,
    tags: elements.tags.value,
    coverUrl: elements.coverUrl.value,
    scheduleAt: elements.scheduleAt.value,
    audience: elements.audience.value,
    voice: elements.voice.value,
    cta: elements.cta.value
  };
}

function writeSourceContent(source = {}) {
  elements.title.value = source.title || "";
  elements.body.value = source.body || "";
  elements.tags.value = Array.isArray(source.tags) ? source.tags.join(",") : source.tags || "";
  elements.coverUrl.value = source.coverUrl || "";
  elements.scheduleAt.value = source.scheduleAt || "";
  elements.audience.value = source.audience || "";
  elements.voice.value = source.voice || "";
  elements.cta.value = source.cta || "";
}

function selectedPlatforms() {
  const checked = [...document.querySelectorAll("input[name='platform']:checked")].map((input) => input.value);
  return checked.length ? checked : getPlatformRegistry(state.customPlatforms).order;
}

function adaptCurrentContent() {
  const platforms = selectedPlatforms();
  state.adapted = adaptForPlatforms(readSourceContent(), platforms, state.customPlatforms);
  elements.platformCount.textContent = String(platforms.length);
  renderQuality();
  renderPreviews();
}

async function publishCurrentContent() {
  if (!state.adapted.length) {
    adaptCurrentContent();
  }

  const results = await publishToPlatforms(state.adapted);
  state.logs = [...results, ...state.logs].slice(0, 50);
  saveJson(storageKeys.logs, state.logs);
  renderLogs();

  const scheduledCount = results.filter((item) => item.status === "scheduled").length;
  const successCount = results.filter((item) => item.status === "success").length;
  const failedCount = results.filter((item) => item.status === "failed").length;
  elements.summaryText.textContent = `已处理 ${results.length} 个平台：成功 ${successCount}，排期 ${scheduledCount}，失败 ${failedCount}`;
}

function exportWorkspace() {
  if (!state.adapted.length) {
    adaptCurrentContent();
  }
  const payload = JSON.stringify(
    {
      version: 2,
      exportedAt: new Date().toISOString(),
      source: readSourceContent(),
      customPlatforms: state.customPlatforms,
      adapted: state.adapted,
      logs: state.logs
    },
    null,
    2
  );
  downloadText("content-bridge-workspace.json", payload, "application/json");
}

async function importWorkspace(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    const payload = JSON.parse(await file.text());
    writeSourceContent(payload.source || {});
    state.customPlatforms = sanitizeCustomPlatforms(payload.customPlatforms || []);
    saveJson(storageKeys.customPlatforms, state.customPlatforms);
    if (Array.isArray(payload.logs)) {
      state.logs = payload.logs.slice(0, 50);
      saveJson(storageKeys.logs, state.logs);
    }
    renderPlatformChoices();
    adaptCurrentContent();
    renderLogs();
    elements.summaryText.textContent = "工作区已导入";
  } catch {
    elements.summaryText.textContent = "导入失败，请检查 JSON 文件格式";
  } finally {
    event.target.value = "";
  }
}

function saveDraft() {
  autoSaveDraft();
  elements.summaryText.textContent = "草稿已保存到浏览器本地";
}

function autoSaveDraft() {
  saveJson(storageKeys.draft, readSourceContent());
}

function restoreDraftOrSample() {
  const draft = loadJson(storageKeys.draft, null);
  if (draft && (draft.title || draft.body)) {
    writeSourceContent(draft);
    return;
  }
  loadSampleContent();
}

function renderPlatformChoices() {
  const registry = getPlatformRegistry(state.customPlatforms);
  elements.platformChoices.innerHTML = registry.order
    .map((key) => {
      const meta = registry.meta[key];
      return `
        <label class="choice">
          <input type="checkbox" name="platform" value="${escapeHtml(key)}" checked />
          ${escapeHtml(meta.displayName)}
          <span>${escapeHtml(meta.tone)}</span>
        </label>
      `;
    })
    .join("");

  document.querySelectorAll("input[name='platform']").forEach((input) => {
    input.addEventListener("change", adaptCurrentContent);
  });
}

function addCustomPlatform() {
  const next = sanitizeCustomPlatforms([
    ...state.customPlatforms,
    {
      key: elements.customKey.value,
      displayName: elements.customName.value,
      tone: elements.customTone.value,
      publishMode: elements.customMode.value,
      limits: {
        titleMax: elements.customTitleMax.value,
        tagMax: elements.customTagMax.value,
        bodyMin: elements.customBodyMin.value
      },
      requiresCover: elements.customCover.checked
    }
  ]);

  const unique = new Map(next.map((item) => [item.key, item]));
  state.customPlatforms = [...unique.values()];
  saveJson(storageKeys.customPlatforms, state.customPlatforms);
  clearCustomPlatformForm();
  renderPlatformChoices();
  adaptCurrentContent();
  elements.summaryText.textContent = "自定义平台已添加";
}

function resetCustomPlatforms() {
  state.customPlatforms = [];
  saveJson(storageKeys.customPlatforms, state.customPlatforms);
  renderPlatformChoices();
  adaptCurrentContent();
  elements.summaryText.textContent = "自定义平台已重置";
}

function clearCustomPlatformForm() {
  elements.customKey.value = "";
  elements.customName.value = "";
  elements.customTitleMax.value = "55";
  elements.customTagMax.value = "8";
  elements.customBodyMin.value = "60";
  elements.customTone.value = "";
  elements.customMode.value = "";
  elements.customCover.checked = false;
}

function renderQuality() {
  const result = scoreSourceContent(readSourceContent());
  elements.qualityScore.textContent = String(result.score);
  elements.qualityHeadline.textContent = result.score >= 85 ? "发布准备度优秀" : result.score >= 70 ? "内容质量较好" : "内容仍可优化";
  elements.qualityHint.textContent = "质量检查会影响发布前提示，不会阻止模拟发布。";
  elements.qualityList.innerHTML = result.suggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderPreviews() {
  elements.previewGrid.innerHTML = "";
  elements.summaryText.textContent = `${state.adapted.length} 个平台已生成适配结果`;

  state.adapted.forEach((item) => {
    const card = document.createElement("article");
    card.className = "preview-card";
    card.innerHTML = `
      <div class="card-head">
        <div>
          <p class="platform-name">${escapeHtml(item.displayName)}</p>
          <h3>${escapeHtml(item.title)}</h3>
        </div>
        <span>${escapeHtml(item.tone)}</span>
      </div>
      <p class="summary">${escapeHtml(item.summary)}</p>
      <div class="title-options">${item.titleOptions.map((title) => `<button type="button" data-title="${escapeHtml(item.platform)}">${escapeHtml(title)}</button>`).join("")}</div>
      <textarea data-platform="${escapeHtml(item.platform)}" aria-label="${escapeHtml(item.displayName)} 适配正文">${escapeHtml(item.body)}</textarea>
      <div class="card-actions">
        <button type="button" data-copy="${escapeHtml(item.platform)}">复制文案</button>
        <button type="button" data-prompt="${escapeHtml(item.platform)}">复制 AI 提示词</button>
        <button type="button" data-export="${escapeHtml(item.platform)}">导出 Markdown</button>
      </div>
      <details class="prompt-panel">
        <summary>AI 改写提示词</summary>
        <textarea readonly>${escapeHtml(item.aiPrompt)}</textarea>
      </details>
      <div class="tag-row">${item.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}</div>
      <div class="issues">${renderIssues(item)}</div>
      <p class="limits">${renderLimits(item.platform)}</p>
    `;
    elements.previewGrid.appendChild(card);
  });

  elements.previewGrid.querySelectorAll("textarea[data-platform]").forEach((textarea) => {
    textarea.addEventListener("input", () => updateAdaptedBody(textarea.dataset.platform, textarea.value));
  });
  elements.previewGrid.querySelectorAll("[data-title]").forEach((button) => {
    button.addEventListener("click", () => useTitleOption(button.dataset.title, button.textContent));
  });
  elements.previewGrid.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", () => copyPlatformContent(button.dataset.copy));
  });
  elements.previewGrid.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => copyAiPrompt(button.dataset.prompt));
  });
  elements.previewGrid.querySelectorAll("[data-export]").forEach((button) => {
    button.addEventListener("click", () => exportPlatformMarkdown(button.dataset.export));
  });
}

function updateAdaptedBody(platform, body) {
  const item = state.adapted.find((content) => content.platform === platform);
  if (item) {
    item.body = body;
  }
}

function useTitleOption(platform, title) {
  const item = state.adapted.find((content) => content.platform === platform);
  if (item) {
    item.title = title;
    renderPreviews();
    elements.summaryText.textContent = `${item.displayName} 标题已替换`;
  }
}

function renderIssues(item) {
  if (!item.validation.issues.length) {
    return '<span class="ok">校验通过</span>';
  }
  return item.validation.issues
    .map((issue) => `<span class="${issue.level}">${escapeHtml(issue.message)}</span>`)
    .join("");
}

function renderLimits(platform) {
  const meta = getPlatformRegistry(state.customPlatforms).meta[platform] || platformMeta[platform];
  return `发布类型：${meta.publishMode}；标题 <= ${meta.limits.titleMax} 字，标签 <= ${meta.limits.tagMax} 个，正文建议 >= ${meta.limits.bodyMin} 字`;
}

function renderLogs() {
  elements.logCount.textContent = String(state.logs.length);
  if (!state.logs.length) {
    elements.publishLog.innerHTML = '<p class="empty">暂无发布记录</p>';
    return;
  }

  elements.publishLog.innerHTML = state.logs
    .map((log) => {
      const statusText = statusLabel(log.status);
      return `
        <article class="log-item">
          <span class="log-status ${log.status}">${statusText}</span>
          <div>
            <strong>${escapeHtml(log.displayName)} | ${escapeHtml(log.title)}</strong>
            <p>${formatTime(log.publishedAt)}${log.scheduledAt ? ` · 计划 ${escapeHtml(log.scheduledAt)}` : ""}${log.reason ? ` · ${escapeHtml(log.reason)}` : ""}</p>
          </div>
        </article>
      `;
    })
    .join("");
}

function copyPlatformContent(platform) {
  const item = state.adapted.find((content) => content.platform === platform);
  if (!item) {
    return;
  }
  copyText(buildMarkdown(item), `${item.displayName} 文案已复制`);
}

function copyAiPrompt(platform) {
  const item = state.adapted.find((content) => content.platform === platform);
  if (!item) {
    return;
  }
  copyText(item.aiPrompt, `${item.displayName} AI 提示词已复制`);
}

function copyText(text, successMessage) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text);
    elements.summaryText.textContent = successMessage;
    return;
  }
  downloadText("content-bridge-copy.txt", text, "text/plain");
}

function exportPlatformMarkdown(platform) {
  const item = state.adapted.find((content) => content.platform === platform);
  if (!item) {
    return;
  }
  downloadText(`${platform}-content.md`, buildMarkdown(item), "text/markdown");
}

function buildMarkdown(item) {
  const tags = item.tags.map((tag) => `#${tag}`).join(" ");
  return [`# ${item.title}`, "", item.body, "", tags].join("\n");
}

function loadSampleContent() {
  writeSourceContent({
    title: "AI 工具如何提升多平台内容发布效率",
    body: [
      "很多创作者会把同一篇内容发布到公众号、知乎、B站和小红书，但每个平台的标题长度、标签习惯、正文结构和表达风格都不一样。",
      "如果每次都手动改写，很容易把时间消耗在复制、排版和检查规则上。",
      "更高效的做法是先维护一份原始内容，再用平台适配规则生成不同版本，并在发布前自动检查限制。",
      "这样既能保持核心观点一致，也能让内容更符合不同平台用户的阅读习惯。",
      "ContentBridge 的目标是把编辑、适配、校验、排期和模拟发布放进同一个工作台，让创作者快速完成跨平台分发准备。"
    ].join("\n\n"),
    tags: "AI工具,内容创作,效率,多平台发布",
    coverUrl: "",
    scheduleAt: "",
    audience: "需要持续更新内容的个人创作者和新媒体运营",
    voice: "专业、清晰、强调可执行",
    cta: "欢迎收藏这套流程，并在评论区分享你的发布渠道"
  });
  autoSaveDraft();
}

function clearLogs() {
  state.logs = [];
  saveJson(storageKeys.logs, state.logs);
  renderLogs();
}

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function statusLabel(status) {
  if (status === "success") {
    return "成功";
  }
  if (status === "scheduled") {
    return "排期";
  }
  return "失败";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function debounce(fn, delay) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}
