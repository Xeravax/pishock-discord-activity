#!/usr/bin/env node
/**
 * Writes version.json for the server + Vite build.
 *
 * Env (CI/Docker preferred):
 *   GIT_SHA, GIT_REF_NAME, GIT_REF_TYPE ("tag" | "branch")
 * Fallback: local git.
 *
 * Labels:
 *   tag v1.2.3     → v1.2.3
 *   branch release → release-<shortsha>
 *   branch develop → develop-<shortsha>
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(cmd) {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function shortSha(sha) {
  const s = String(sha || '').trim();
  if (!s || s === 'unknown') return 'unknown';
  return s.length >= 7 ? s.slice(0, 7) : s;
}

function resolve() {
  let sha = process.env.GIT_SHA || process.env.GITHUB_SHA || '';
  let refName = process.env.GIT_REF_NAME || process.env.GITHUB_REF_NAME || '';
  let refType = process.env.GIT_REF_TYPE || '';

  if (!sha) sha = git('git rev-parse HEAD') || 'unknown';
  if (!refName) {
    const exactTag = git('git describe --exact-match --tags HEAD');
    if (exactTag) {
      refName = exactTag;
      refType = 'tag';
    } else {
      refName = git('git rev-parse --abbrev-ref HEAD') || 'local';
      refType = refName === 'HEAD' ? 'branch' : 'branch';
    }
  }
  if (!refType) {
    refType =
      process.env.GITHUB_REF_TYPE ||
      (refName.startsWith('v') && /^v\d/.test(refName) ? 'tag' : 'branch');
  }

  // Normalize refs/heads/foo or refs/tags/v1
  refName = refName.replace(/^refs\/(heads|tags)\//, '');

  const short = shortSha(sha);
  const builtAt = new Date().toISOString();
  let label;
  if (refType === 'tag' || /^v\d/.test(refName)) {
    label = refName.startsWith('v') ? refName : `v${refName}`;
    refType = 'tag';
  } else {
    const branch = refName && refName !== 'HEAD' ? refName : 'local';
    // Local/placeholder SHAs need a unique stamp so redeploys force client relaunch.
    label =
      short === 'local' || short === 'unknown'
        ? `${branch}-${Date.now().toString(36)}`
        : `${branch}-${short}`;
    refType = 'branch';
  }

  return {
    label,
    version: label,
    sha,
    shortSha: short,
    ref: refName,
    refType,
    builtAt,
  };
}

const info = resolve();
const outPath = path.join(root, 'version.json');
fs.writeFileSync(outPath, `${JSON.stringify(info, null, 2)}\n`, 'utf8');

// Expose to Vite without requiring dotenv
const envPath = path.join(root, '.env.version');
fs.writeFileSync(
  envPath,
  `VITE_APP_VERSION=${info.label}\nVITE_APP_SHA=${info.shortSha}\nVITE_APP_REF=${info.ref}\nVITE_APP_BUILT_AT=${info.builtAt}\n`,
  'utf8',
);

console.log(`[version] ${info.label} (${info.refType} ${info.ref} @ ${info.shortSha})`);
console.log(`[version] wrote ${path.relative(root, outPath)}`);
