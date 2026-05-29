import { sanitizeCustomPlatforms } from "./adapters.js";

export function exportPlatformPreset(customPlatforms = []) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    platforms: sanitizeCustomPlatforms(customPlatforms)
  };
}

export function importPlatformPreset(payload) {
  if (!payload || !Array.isArray(payload.platforms)) {
    return [];
  }
  return sanitizeCustomPlatforms(payload.platforms);
}
