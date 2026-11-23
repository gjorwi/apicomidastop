import { AppConfig } from '../models/index.js';

const CONFIG_KEY = 'platform';

export const DEFAULT_SCAN_RADIUS_METERS = 15;

function normalizeRadius(value) {
  const radius = Number(value);
  if (!Number.isFinite(radius) || radius < 1 || radius > 500) {
    return DEFAULT_SCAN_RADIUS_METERS;
  }
  return radius;
}

function serializeConfig(config) {
  return {
    scanRadiusMeters: normalizeRadius(config?.scanRadiusMeters),
    updatedAt: config?.updatedAt || null,
    updatedBy: config?.updatedBy ? String(config.updatedBy) : null,
  };
}

export async function getPlatformSettings() {
  const config = await AppConfig.findOne({ key: CONFIG_KEY }).lean();
  return serializeConfig(config);
}

export async function updatePlatformSettings({ scanRadiusMeters, updatedBy }) {
  const config = await AppConfig.findOneAndUpdate(
    { key: CONFIG_KEY },
    {
      $set: {
        scanRadiusMeters: normalizeRadius(scanRadiusMeters),
        updatedBy: updatedBy || null,
      },
      $setOnInsert: { key: CONFIG_KEY },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  return serializeConfig(config);
}
