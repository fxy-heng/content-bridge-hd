export function parseMarkdownDraft(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const titleIndex = lines.findIndex((line) => /^#\s+/.test(line));
  const title = titleIndex >= 0 ? lines[titleIndex].replace(/^#\s+/, "").trim() : "";
  const tagLine = lines.find((line) => line.trim().startsWith("tags:") || line.trim().startsWith("标签:"));
  const tags = tagLine ? tagLine.split(":").slice(1).join(":").trim() : extractHashTags(markdown).join(",");
  const body = lines
    .filter((line, index) => index !== titleIndex)
    .filter((line) => !line.trim().startsWith("tags:") && !line.trim().startsWith("标签:"))
    .join("\n")
    .trim();

  return {
    title,
    body,
    tags
  };
}

function extractHashTags(markdown) {
  return [...String(markdown || "").matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map((match) => match[1]);
}
