import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_FILE = join(__dirname, "..", "data", "credentials.json");

function readCredentials() {
  try {
    if (!existsSync(CREDENTIALS_FILE)) {
      mkdirSync(dirname(CREDENTIALS_FILE), { recursive: true });
      writeFileSync(CREDENTIALS_FILE, "{}");
      return {};
    }
    return JSON.parse(readFileSync(CREDENTIALS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeCredentials(data) {
  mkdirSync(dirname(CREDENTIALS_FILE), { recursive: true });
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2));
}

export function getCredentials(platform) {
  const all = readCredentials();
  return all[platform] || null;
}

export function saveCredentials(platform, creds) {
  const all = readCredentials();
  all[platform] = {
    ...creds,
    updatedAt: new Date().toISOString()
  };
  writeCredentials(all);
  return all[platform];
}

export function deleteCredentials(platform) {
  const all = readCredentials();
  delete all[platform];
  writeCredentials(all);
}

export function listCredentials() {
  const all = readCredentials();
  return Object.entries(all).map(([platform, creds]) => ({
    platform,
    displayName: creds.displayName || platform,
    hasCredentials: Boolean(creds.appId || creds.cookiePath),
    updatedAt: creds.updatedAt || ""
  }));
}
