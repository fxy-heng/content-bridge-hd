import { adaptForPlatforms, platformMeta, platformOrder, scoreSourceContent } from "./core/adapters.js";
import { publishToPlatforms } from "./core/publisher.js";

const storageKeys = {
  logs: "contentBridge.logs",
  draft: "contentBridge.draft"
};

const state = {
  adapted: [],
  logs: loadJson(storageKeys.logs, [])
};

const elements = {
  title: document.querySelector("#sourceTitle"),
  body: document.querySelector("#sourceBody"),
  tags: document.querySelector("#sourceTags"),
  coverUrl: document.querySelector("#coverUrl"),
  scheduleAt: document.querySelector("#scheduleAt"),
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
  saveDraft: document.querySelector("#saveDraft"),
  loadSample: document.querySelector("#loadSample"),
  clearLog: document.querySelector("#clearLog")
};

elements.adaptButton.addEventListener("click", adaptCurrentContent);
elements.publishButton.addEventListener("click", publishCurrentContent);
elements.exportButton.addEventListener("click", exportAdaptedContent);
elements.saveDraft.addEventListener("click", saveDraft);
elements.loadSample.addEventListener("click", () => {
  loadSampleContent();
  adaptCurrentContent();
});
elements.clearLog.addEventListener("click", clearLogs);

[elements.title, elements.body, elements.tags, elements.coverUrl, elements.scheduleAt].forEach((input) => {
  input.addEventListener("input", debounce(() => {
    autoSaveDraft();
    adaptCurrentContent();
  }, 250));
});

document.querySelectorAll("input[name='platform']").forEach((input) => {
  input.addEventListener("change", adaptCurrentContent);
});

restoreDraftOrSample();
adaptCurrentContent();
renderLogs();

function readSourceContent() {
  return {
    title: elements.title.value,
    body: elements.body.value,
    tags: elements.tags.value,
    coverUrl: elements.coverUrl.value,
    scheduleAt: elements.scheduleAt.value
  };
}

function selectedPlatforms() {
  const checked = [...document.querySelectorAll("input[name='platform']:checked")].map((input) => input.value);
  return checked.length ? checked : platformOrder;
}

function adaptCurrentContent() {
  const platforms = selectedPlatforms();
  state.adapted = adaptForPlatforms(readSourceContent(), platforms);
  elements.platformCount.textContent = String(platforms.length);
  renderQuality();
  renderPreviews();
}

async function publishCurrentContent() {
  if (!state.adapted.length) {
    adaptCurrentContent();
  }

  const results = await publishToPlatforms(state.adapted);
  state.logs = [...results, ...state.logs].slice(0, 30);
  saveJson(storageKeys.logs, state.logs);
  renderLogs();

  const scheduledCount = results.filter((item) => item.status === "scheduled").length;
  const successCount = results.filter((item) => item.status === "success").length;
  elements.summaryText.textContent = `已处理 ${results.length} 个平台：成功 ${successCount}，排期 ${scheduledCount}`;
}

function exportAdaptedContent() {
  if (!state.adapted.length) {
    adaptCurrentContent();
  }
  const payload = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      source: readSourceContent(),
      items: state.adapted
    },
    null,
    2
  );
  downloadText("content-bridge-export.json", payload, "application/json");
}

function saveDraft() {
  saveJson(storageKeys.draft, readSourceContent());
  elements.summaryText.textContent = "草稿已保存到浏览器本地";
}

function autoSaveDraft() {
  saveJson(storageKeys.draft, readSourceContent());
}

function restoreDraftOrSample() {
  const draft = loadJson(storageKeys.draft, null);
  if (draft && (draft.title || draft.body)) {
    elements.title.value = draft.title || "";
    elements.body.value = draft.body || "";
    elements.tags.value = Array.isArray(draft.tags) ? draft.tags.join(",") : draft.tags || "";
    elements.coverUrl.value = draft.coverUrl || "";
    elements.scheduleAt.value = draft.scheduleAt || "";
    return;
  }
  loadSampleContent();
}

function renderQuality() {
  const result = scoreSourceContent(readSourceContent());
  elements.qualityScore.textContent = String(result.score);
  elements.qualityHeadline.textContent = result.score >= 80 ? "内容质量较好" : "内容仍可优化";
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
      <textarea data-platform="${escapeHtml(item.platform)}" aria-label="${escapeHtml(item.displayName)} 适配正文">${escapeHtml(item.body)}</textarea>
      <div class="card-actions">
        <button type="button" data-copy="${escapeHtml(item.platform)}">复制文案</button>
        <button type="button" data-export="${escapeHtml(item.platform)}">导出 Markdown</button>
      </div>
      <div class="tag-row">${item.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}</div>
      <div class="issues">${renderIssues(item)}</div>
      <p class="limits">${renderLimits(item.platform)}</p>
    `;
    elements.previewGrid.appendChild(card);
  });

  elements.previewGrid.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", () => copyPlatformContent(button.dataset.copy));
  });
  elements.previewGrid.querySelectorAll("[data-export]").forEach((button) => {
    button.addEventListener("click", () => exportPlatformMarkdown(button.dataset.export));
  });
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
  const meta = platformMeta[platform];
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
  const text = buildMarkdown(item);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text);
    elements.summaryText.textContent = `${item.displayName} 文案已复制`;
    return;
  }
  downloadText(`${platform}.md`, text, "text/markdown");
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
  elements.title.value = "AI 工具如何提升多平台内容发布效率";
  elements.body.value = [
    "很多创作者会把同一篇内容发布到公众号、知乎、B站和小红书，但每个平台的标题长度、标签习惯、正文结构和表达风格都不一样。",
    "如果每次都手动改写，很容易把时间消耗在复制、排版和检查规则上。",
    "更高效的做法是先维护一份原始内容，再用平台适配规则生成不同版本，并在发布前自动检查限制。",
    "这样既能保持核心观点一致，也能让内容更符合不同平台用户的阅读习惯。",
    "ContentBridge 的目标是把编辑、适配、校验、排期和模拟发布放进同一个工作台，让创作者快速完成跨平台分发准备。"
  ].join("\n\n");
  elements.tags.value = "AI工具,内容创作,效率,多平台发布";
  elements.coverUrl.value = "";
  elements.scheduleAt.value = "";
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
