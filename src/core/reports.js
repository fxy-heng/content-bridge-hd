export function buildReadinessCsv(adaptedItems) {
  const rows = [
    ["platform", "displayName", "status", "title", "issueCount", "issues", "scheduleAt"]
  ];

  adaptedItems.forEach((item) => {
    const status = !item.validation.ok ? "blocked" : item.validation.issues.length ? "warning" : "ready";
    rows.push([
      item.platform,
      item.displayName,
      status,
      item.title,
      String(item.validation.issues.length),
      item.validation.issues.map((issue) => issue.message).join("; "),
      item.scheduleAt || ""
    ]);
  });

  return toCsv(rows);
}

export function buildPublishLogCsv(logs) {
  const rows = [["id", "platform", "displayName", "title", "status", "reason", "scheduledAt", "publishedAt"]];

  logs.forEach((log) => {
    rows.push([
      log.id,
      log.platform,
      log.displayName,
      log.title,
      log.status,
      log.reason || "",
      log.scheduledAt || "",
      log.publishedAt || ""
    ]);
  });

  return toCsv(rows);
}

function toCsv(rows) {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\r\n");
}

function escapeCell(value) {
  const text = String(value ?? "");
  if (!/[",\r\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}
