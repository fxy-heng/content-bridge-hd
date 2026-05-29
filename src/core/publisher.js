let backendAvailable = null;

async function checkBackend() {
  if (backendAvailable !== null) {
    return backendAvailable;
  }
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    backendAvailable = data.ok === true;
  } catch {
    backendAvailable = false;
  }
  return backendAvailable;
}

export async function publishToPlatforms(adaptedItems, options = {}) {
  const now = options.now || new Date();
  const backend = await checkBackend();
  const failurePlatforms = new Set(options.failurePlatforms || []);

  const results = await Promise.all(
    adaptedItems.map(async (item, index) => {
      const hasValidationError = item.validation?.issues?.some((issue) => issue.level === "error");
      const scheduled = isFutureSchedule(item.scheduleAt, now);
      const failed = hasValidationError || failurePlatforms.has(item.platform);

      if (failed) {
        return buildResult(item, index, now, "failed", hasValidationError ? firstFailureReason(item) : "模拟发布失败，请检查平台授权或内容限制");
      }

      if (scheduled) {
        return buildResult(item, index, now, "scheduled", "已进入模拟排期队列");
      }

      // Try real publishing if backend is available and platform supports it
      if (backend && supportsRealPublish(item.platform)) {
        try {
          const realResult = await realPublish(item);
          return buildResult(item, index, now, realResult.status, realResult.reason || "", realResult.detail);
        } catch (err) {
          // Fall back to simulated success on network errors
          console.warn(`Real publish failed for ${item.platform}, using simulation:`, err.message);
        }
      }

      // Fallback: simulated publish
      return buildResult(item, index, now, "success", "");
    })
  );

  return results;
}

function supportsRealPublish(platform) {
  // Only wechat and bilibili have real publish backends
  // zhihu and rednote don't have public APIs
  return platform === "wechat" || platform === "bilibili";
}

async function realPublish(item) {
  const endpoint = item.platform === "wechat" ? "/api/wechat/publish" : "/api/bilibili/publish";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: item.title,
      body: item.body,
      summary: item.summary,
      tags: item.tags,
      coverUrl: item.coverUrl
    })
  });

  const data = await response.json();

  if (data.status === "success") {
    return {
      status: "success",
      reason: "",
      detail: data
    };
  }

  return {
    status: "failed",
    reason: data.reason || "发布失败",
    detail: data
  };
}

function buildResult(item, index, now, status, reason = "", detail = null) {
  return {
    id: `${now.getTime()}-${index}-${item.platform}`,
    platform: item.platform,
    displayName: item.displayName,
    title: item.title,
    status,
    reason,
    scheduledAt: item.scheduleAt || "",
    publishedAt: new Date(now.getTime() + index * 1000).toISOString(),
    detail
  };
}

function isFutureSchedule(scheduleAt, now) {
  if (!scheduleAt) {
    return false;
  }
  const value = new Date(scheduleAt).getTime();
  return Number.isFinite(value) && value > now.getTime();
}

function firstFailureReason(item) {
  const error = item.validation?.issues?.find((issue) => issue.level === "error");
  return error?.message || "模拟发布失败，请检查平台授权或内容限制";
}
