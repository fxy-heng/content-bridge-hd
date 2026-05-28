export async function publishToPlatforms(adaptedItems, options = {}) {
  const now = options.now || new Date();
  const failurePlatforms = new Set(options.failurePlatforms || []);

  return adaptedItems.map((item, index) => {
    const hasValidationError = item.validation?.issues?.some((issue) => issue.level === "error");
    const scheduled = isFutureSchedule(item.scheduleAt, now);
    const failed = hasValidationError || failurePlatforms.has(item.platform);

    return {
      id: `${now.getTime()}-${index}-${item.platform}`,
      platform: item.platform,
      displayName: item.displayName,
      title: item.title,
      status: failed ? "failed" : scheduled ? "scheduled" : "success",
      reason: failed ? firstFailureReason(item) : scheduled ? "已进入模拟排期队列" : "",
      scheduledAt: item.scheduleAt || "",
      publishedAt: new Date(now.getTime() + index * 1000).toISOString()
    };
  });
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
