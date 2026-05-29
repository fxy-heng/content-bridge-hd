export function buildScheduleCalendar(adaptedItems, options = {}) {
  const scheduledItems = adaptedItems.filter((item) => item.scheduleAt);
  const now = options.now || new Date();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ContentBridge//Publishing Schedule//ZH-CN",
    "CALSCALE:GREGORIAN"
  ];

  scheduledItems.forEach((item, index) => {
    const start = parseScheduleDate(item.scheduleAt);
    if (!start) {
      return;
    }
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcs(`${now.getTime()}-${index}-${item.platform}@contentbridge`)}`,
      `DTSTAMP:${formatIcsDate(now)}`,
      `DTSTART:${formatIcsDate(start)}`,
      `DTEND:${formatIcsDate(end)}`,
      `SUMMARY:${escapeIcs(`${item.displayName} 发布：${item.title}`)}`,
      `DESCRIPTION:${escapeIcs(`平台：${item.displayName}\\n发布类型：${item.publishMode}\\n标签：${item.tags.map((tag) => `#${tag}`).join(" ")}`)}`,
      "END:VEVENT"
    );
  });

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function countScheduledItems(adaptedItems) {
  return adaptedItems.filter((item) => Boolean(parseScheduleDate(item.scheduleAt))).length;
}

function parseScheduleDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatIcsDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}
