import { adaptForPlatforms, platformMeta, platformOrder } from "./core/adapters.js";
import { publishToPlatforms } from "./core/publisher.js";

const state = {
  adapted: [],
  logs: loadLogs()
};

const elements = {
  title: document.querySelector("#sourceTitle"),
  body: document.querySelector("#sourceBody"),
  tags: document.querySelector("#sourceTags"),
  coverUrl: document.querySelector("#coverUrl"),
  previewGrid: document.querySelector("#previewGrid"),
  summaryText: document.querySelector("#summaryText"),
  publishLog: document.querySelector("#publishLog"),
  adaptButton: document.querySelector("#adaptButton"),
  publishButton: document.querySelector("#publishButton"),
  exportButton: document.querySelector("#exportButton"),
  loadSample: document.querySelector("#loadSample"),
  clearLog: document.querySelector("#clearLog")
};

elements.adaptButton.addEventListener("click", adaptCurrentContent);
elements.publishButton.addEventListener("click", publishCurrentContent);
elements.exportButton.addEventListener("click", exportAdaptedContent);
elements.loadSample.addEventListener("click", loadSampleContent);
elements.clearLog.addEventListener("click", clearLogs);

renderLogs();
loadSampleContent();
adaptCurrentContent();

function readSourceContent() {
  return {
    title: elements.title.value,
    body: elements.body.value,
    tags: elements.tags.value,
    coverUrl: elements.coverUrl.value
  };
}

function selectedPlatforms() {
  const checked = [...document.querySelectorAll("input[name='platform']:checked")].map((input) => input.value);
  return checked.length ? checked : platformOrder;
}

function adaptCurrentContent() {
  state.adapted = adaptForPlatforms(readSourceContent(), selectedPlatforms());
  renderPreviews();
}

async function publishCurrentContent() {
  if (!state.adapted.length) {
    adaptCurrentContent();
  }

  const results = await publishToPlatforms(state.adapted);
  state.logs = [...results, ...state.logs].slice(0, 20);
  saveLogs();
  renderLogs();
  elements.summaryText.textContent = `已模拟发布 ${results.length} 个平台`;
}

function exportAdaptedContent() {
  if (!state.adapted.length) {
    adaptCurrentContent();
  }
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), items: state.adapted }, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "content-bridge-export.json";
  link.click();
  URL.revokeObjectURL(url);
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
      <textarea aria-label="${escapeHtml(item.displayName)} 适配正文">${escapeHtml(item.body)}</textarea>
      <div class="tag-row">${item.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}</div>
      <div class="issues">${renderIssues(item)}</div>
      <p class="limits">${renderLimits(item.platform)}</p>
    `;
    elements.previewGrid.appendChild(card);
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
  return `标题 <= ${meta.limits.titleMax} 字，标签 <= ${meta.limits.tagMax} 个，正文建议 >= ${meta.limits.bodyMin} 字`;
}

function renderLogs() {
  if (!state.logs.length) {
    elements.publishLog.innerHTML = '<p class="empty">暂无发布记录</p>';
    return;
  }

  elements.publishLog.innerHTML = state.logs
    .map((log) => {
      const statusText = log.status === "success" ? "成功" : "失败";
      return `
        <article class="log-item">
          <span class="log-status ${log.status}">${statusText}</span>
          <div>
            <strong>${escapeHtml(log.displayName)}｜${escapeHtml(log.title)}</strong>
            <p>${formatTime(log.publishedAt)}${log.reason ? ` · ${escapeHtml(log.reason)}` : ""}</p>
          </div>
        </article>
      `;
    })
    .join("");
}

function loadSampleContent() {
  elements.title.value = "AI 工具如何提升多平台内容发布效率";
  elements.body.value = [
    "很多创作者会把同一篇内容发布到公众号、知乎、B站和小红书，但每个平台的标题长度、标签习惯、正文结构和表达风格都不一样。",
    "如果每次都手动改写，很容易把时间消耗在复制、排版和检查规则上。",
    "更高效的做法是先维护一份原始内容，再用平台适配规则生成不同版本，并在发布前自动检查限制。",
    "这样既能保持核心观点一致，也能让内容更符合不同平台用户的阅读习惯。"
  ].join("\n\n");
  elements.tags.value = "AI工具,内容创作,效率,多平台发布";
  elements.coverUrl.value = "";
}

function clearLogs() {
  state.logs = [];
  saveLogs();
  renderLogs();
}

function loadLogs() {
  try {
    return JSON.parse(localStorage.getItem("contentBridge.logs") || "[]");
  } catch {
    return [];
  }
}

function saveLogs() {
  localStorage.setItem("contentBridge.logs", JSON.stringify(state.logs));
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

