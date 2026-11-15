#!/usr/bin/env node
/**
 * Writes release-notes.json for /api/version and the in-app “Latest version” panel.
 *
 * Env (CI preferred):
 *   RELEASE_VERSION, RELEASE_NOTES, RELEASE_URL, RELEASE_PUBLISHED_AT
 * Or reads an existing release-notes.json / leaves a branch-build stub.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(root, 'release-notes.json');

function readExisting() {
  try {
    if (!fs.existsSync(outPath)) return null;
    return JSON.parse(fs.readFileSync(outPath, 'utf8'));
  } catch {
    return null;
  }
}

function readVersionLabel() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
    return String(raw.label || raw.version || '');
  } catch {
    return '';
  }
}

const existing = readExisting();
const version =
  process.env.RELEASE_VERSION?.trim() ||
  existing?.version ||
  readVersionLabel() ||
  'dev';
const notes =
  process.env.RELEASE_NOTES != null
    ? String(process.env.RELEASE_NOTES)
    : existing?.notes != null
      ? String(existing.notes)
      : '';
const url =
  process.env.RELEASE_URL?.trim() ||
  (existing?.url != null ? String(existing.url) : null);
const publishedAt =
  process.env.RELEASE_PUBLISHED_AT?.trim() ||
  (existing?.publishedAt != null ? String(existing.publishedAt) : null);

const payload = {
  version,
  notes,
  url,
  publishedAt,
  updatedAt: new Date().toISOString(),
};

fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(
  `[release-notes] ${payload.version} (${payload.notes ? `${payload.notes.length} chars` : 'no notes'})`,
);
