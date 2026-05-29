import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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
  const payload = JSON.stringify(data, null, 2);
  const tempFile = `${credentialsFile}.${process.pid}.${Date.now()}.tmp`;
  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      writeFileSync(tempFile, payload, "utf8");
      renameSync(tempFile, credentialsFile);
      return;
    } catch (error) {
      lastError = error;
      try {
        if (existsSync(tempFile)) {
          unlinkSync(tempFile);
        }
      } catch {
        // Best effort cleanup only.
      }

      if (!["EPERM", "EBUSY", "EACCES"].includes(error.code)) {
        break;
      }
      sleep(80 * (attempt + 1));
    }
  }

  const message = lastError?.message || "Unknown credential storage error";
  throw new Error(`Unable to write credential store at ${credentialsFile}: ${message}`);
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

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Synchronous retry backoff keeps this tiny storage helper dependency-free.
  }
}
