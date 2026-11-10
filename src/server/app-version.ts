import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppVersionInfo } from '../shared/app-version.js';

const FALLBACK: AppVersionInfo = {
  label: 'dev',
  version: 'dev',
  sha: 'unknown',
  shortSha: 'unknown',
  ref: 'local',
  refType: 'branch',
  builtAt: new Date(0).toISOString(),
};

function tryRead(filePath: string): AppVersionInfo | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<AppVersionInfo>;
    if (!raw.label) return null;
    return {
      label: String(raw.label),
      version: String(raw.version ?? raw.label),
      sha: String(raw.sha ?? 'unknown'),
      shortSha: String(raw.shortSha ?? String(raw.sha ?? 'unknown').slice(0, 7)),
      ref: String(raw.ref ?? 'local'),
      refType: String(raw.refType ?? 'branch'),
      builtAt: String(raw.builtAt ?? new Date(0).toISOString()),
    };
  } catch {
    return null;
  }
}

/** Load build-time version.json (repo root, cwd, or next to the server bundle). */
export function loadAppVersion(): AppVersionInfo {
  const fromEnv = process.env.APP_VERSION?.trim();
  if (fromEnv) {
    return {
      ...FALLBACK,
      label: fromEnv,
      version: fromEnv,
      sha: process.env.GIT_SHA || FALLBACK.sha,
      shortSha: (process.env.GIT_SHA || FALLBACK.sha).slice(0, 7),
      ref: process.env.GIT_REF_NAME || FALLBACK.ref,
      refType: process.env.GIT_REF_TYPE || FALLBACK.refType,
      builtAt: process.env.APP_BUILT_AT || new Date().toISOString(),
    };
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), 'version.json'),
    path.resolve(here, '../../version.json'),
    path.resolve(here, '../../../version.json'),
    path.resolve(here, '../version.json'),
  ];
  for (const candidate of candidates) {
    const info = tryRead(candidate);
    if (info) return info;
  }
  return { ...FALLBACK, builtAt: new Date().toISOString() };
}
