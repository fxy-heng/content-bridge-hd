let backendCache = null;

async function getBackendState() {
  if (backendCache && backendCache.expiresAt > Date.now()) {
    return backendCache.value;
  }

  const fallback = { available: false, realPlatforms: new Set(), credentials: [] };
  try {
    const healthResponse = await fetch("/api/health");
    const health = await healthResponse.json();
    if (!health.ok) {
      return fallback;
    }

    const credentialsResponse = await fetch("/api/credentials");
    const credentials = credentialsResponse.ok ? await credentialsResponse.json() : [];
    const realPlatforms = new Set(
      credentials
        .filter((item) => item.connected)
        .map((item) => item.platform)
    );

    // Bilibili uses a persisted browser profile rather than static credentials.
    // When the backend is running, the real publish path can report login_required
    // and open the QR-login flow instead of silently pretending a publish worked.
    realPlatforms.add("bilibili");

    const value = { available: true, realPlatforms, credentials };
    backendCache = { value, expiresAt: Date.now() + 5000 };
    return value;
  } catch {
    return fallback;
  }
}

export async function publishToPlatforms(adaptedItems, options = {}) {
  const now = options.now || new Date();
  const backend = await getBackendState();
  const failurePlatforms = new Set(options.failurePlatforms || []);

  const results = await Promise.all(
    adaptedItems.map(async (item, index) => {
      const hasValidationError = item.validation?.issues?.some((issue) => issue.level === "error");
      const scheduled = isFutureSchedule(item.scheduleAt, now);
      const failed = hasValidationError || failurePlatforms.has(item.platform);

      if (failed) {
        return buildResult(
          item,
          index,
          now,
          "failed",
          hasValidationError ? firstFailureReason(item) : "Simulated publish failed. Check platform authorization or content limits.",
          null,
          "simulated"
        );
      }

      if (scheduled) {
        return buildResult(item, index, now, "scheduled", "Added to the simulated scheduling queue.", null, "simulated");
      }

      if (backend.available && supportsRealPublish(item.platform) && backend.realPlatforms.has(item.platform)) {
        try {
          const realResult = await realPublish(item);
          const status = realResult.status === "success" ? "success" : "failed";
          return buildResult(item, index, now, status, realResult.reason || "", realResult.detail, "real");
        } catch (err) {
          console.warn(`Real publish failed for ${item.platform}, using simulation:`, err.message);
        }
      }

      return buildResult(item, index, now, "success", "", null, "simulated");
    })
  );

  return results;
}

function supportsRealPublish(platform) {
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
    status: data.status || "failed",
    reason: data.reason || data.error || "Real publish failed.",
    detail: data
  };
}

function buildResult(item, index, now, status, reason = "", detail = null, mode = "simulated") {
  return {
    id: `${now.getTime()}-${index}-${item.platform}`,
    platform: item.platform,
    displayName: item.displayName,
    title: item.title,
    status,
    reason,
    scheduledAt: item.scheduleAt || "",
    publishedAt: new Date(now.getTime() + index * 1000).toISOString(),
    mode,
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
  return error?.message || "Simulated publish failed. Check platform authorization or content limits.";
}
