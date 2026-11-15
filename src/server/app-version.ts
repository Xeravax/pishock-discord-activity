import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppReleaseNotes, AppVersionInfo } from '../shared/app-version.js';

const FALLBACK: AppVersionInfo = {
  label: 'dev',
  version: 'dev',
  sha: 'unknown',
  shortSha: 'unknown',
  ref: 'local',
  refType: 'branch',
  builtAt: new Date(0).toISOString(),
  release: null,
};

function tryReadJson(filePath: string): unknown | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function tryReadVersion(filePath: string): AppVersionInfo | null {
  const raw = tryReadJson(filePath) as Partial<AppVersionInfo> | null;
  if (!raw?.label) return null;
  return {
    label: String(raw.label),
    version: String(raw.version ?? raw.label),
    sha: String(raw.sha ?? 'unknown'),
    shortSha: String(raw.shortSha ?? String(raw.sha ?? 'unknown').slice(0, 7)),
    ref: String(raw.ref ?? 'local'),
    refType: String(raw.refType ?? 'branch'),
    builtAt: String(raw.builtAt ?? new Date(0).toISOString()),
    release: null,
  };
}

function tryReadReleaseNotes(filePath: string): AppReleaseNotes | null {
  const raw = tryReadJson(filePath) as Partial<AppReleaseNotes> | null;
  if (!raw) return null;
  const version = raw.version != null ? String(raw.version) : '';
  const notes = raw.notes != null ? String(raw.notes) : '';
  if (!version && !notes) return null;
  return {
    version: version || 'unknown',
    notes,
    url: raw.url != null && String(raw.url).trim() ? String(raw.url) : null,
    publishedAt:
      raw.publishedAt != null && String(raw.publishedAt).trim()
        ? String(raw.publishedAt)
        : null,
    updatedAt: raw.updatedAt != null ? String(raw.updatedAt) : undefined,
  };
}

function candidateDirs(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    process.cwd(),
    path.resolve(here, '../..'),
    path.resolve(here, '../../..'),
    path.resolve(here, '..'),
  ];
}

/** Load build-time version.json + optional release-notes.json. */
export function loadAppVersion(): AppVersionInfo {
  const fromEnv = process.env.APP_VERSION?.trim();
  let base: AppVersionInfo | null = null;

  if (fromEnv) {
    base = {
      ...FALLBACK,
      label: fromEnv,
      version: fromEnv,
      sha: process.env.GIT_SHA || FALLBACK.sha,
      shortSha: (process.env.GIT_SHA || FALLBACK.sha).slice(0, 7),
      ref: process.env.GIT_REF_NAME || FALLBACK.ref,
      refType: process.env.GIT_REF_TYPE || FALLBACK.refType,
      builtAt: process.env.APP_BUILT_AT || new Date().toISOString(),
    };
  } else {
    for (const dir of candidateDirs()) {
      const info = tryReadVersion(path.join(dir, 'version.json'));
      if (info) {
        base = info;
        break;
      }
    }
  }

  if (!base) {
    base = { ...FALLBACK, builtAt: new Date().toISOString() };
  }

  let release: AppReleaseNotes | null = null;
  for (const dir of candidateDirs()) {
    release = tryReadReleaseNotes(path.join(dir, 'release-notes.json'));
    if (release) break;
  }

  return { ...base, release };
}
