import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const credentialsFile = join(__dirname, "..", "data", "credentials.json");

function readAll() {
  try {
    if (!existsSync(credentialsFile)) {
      writeAll({});
      return {};
    }
    const text = readFileSync(credentialsFile, "utf8");
    return text.trim() ? JSON.parse(text) : {};
  } catch (error) {
    return {};
  }
}

function writeAll(data) {
  mkdirSync(dirname(credentialsFile), { recursive: true });
  writeFileSync(credentialsFile, JSON.stringify(data, null, 2), "utf8");
}

export function getCredentials(platform) {
  return readAll()[platform] || null;
}

export function saveCredentials(platform, credentials) {
  const all = readAll();
  all[platform] = {
    ...credentials,
    updatedAt: new Date().toISOString()
  };
  writeAll(all);
  return all[platform];
}

export function deleteCredentials(platform) {
  const all = readAll();
  delete all[platform];
  writeAll(all);
}

export function listCredentialSummaries() {
  return Object.entries(readAll()).map(([platform, credentials]) => summarizeCredentials(platform, credentials));
}

export function summarizeCredentials(platform, credentials = getCredentials(platform)) {
  const connected = Boolean(
    credentials &&
    (credentials.appId || credentials.thumbMediaId || credentials.cookiePath || credentials.browserProfile)
  );

  return {
    platform,
    displayName: credentials?.displayName || platform,
    connected,
    updatedAt: credentials?.updatedAt || "",
    detail: {
      appId: credentials?.appId ? maskValue(credentials.appId, 6) : "",
      hasSecret: Boolean(credentials?.appSecret),
      author: credentials?.author || "",
      hasThumbMediaId: Boolean(credentials?.thumbMediaId),
      browserProfile: credentials?.browserProfile || ""
    }
  };
}

function maskValue(value, visible = 4) {
  const text = String(value);
  if (text.length <= visible) {
    return "*".repeat(text.length);
  }
  return `${text.slice(0, visible)}${"*".repeat(Math.min(8, text.length - visible))}`;
}
