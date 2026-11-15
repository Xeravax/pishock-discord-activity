import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PiShockAccountProfile } from './auth-api.js';

export type ProfileImageKind = 'avatar' | 'banner';

type StoredImageMeta = {
  contentType: string;
  source: string;
  version: string;
  updatedAt: string;
  bytes: number;
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

let rootOverride: string | null = null;

export function setProfileImageRootForTests(root: string | null) {
  rootOverride = root;
}

export function profileImageRoot(): string {
  if (rootOverride) return rootOverride;
  const fromEnv = process.env.DATA_DIR?.trim();
  const base = fromEnv || path.join(process.cwd(), 'data');
  return path.join(base, 'pishock-profiles');
}

function userDir(pishockUserId: number): string {
  return path.join(profileImageRoot(), String(pishockUserId));
}

function metaPath(pishockUserId: number, kind: ProfileImageKind): string {
  return path.join(userDir(pishockUserId), `${kind}.meta.json`);
}

function binPath(pishockUserId: number, kind: ProfileImageKind): string {
  return path.join(userDir(pishockUserId), `${kind}.bin`);
}

export function mediaPublicPath(pishockUserId: number, kind: ProfileImageKind, version?: string | null): string {
  const base = `/api/pishock/media/${pishockUserId}/${kind}`;
  if (!version) return base;
  return `${base}?v=${encodeURIComponent(version)}`;
}

function versionFromSource(source: string): string {
  try {
    if (/^https?:\/\//i.test(source)) {
      const url = new URL(source);
      const v = url.searchParams.get('v')?.trim();
      if (v) return v;
    }
  } catch {
    // fall through
  }
  return createHash('sha256').update(source).digest('hex').slice(0, 24);
}

async function readMeta(pishockUserId: number, kind: ProfileImageKind): Promise<StoredImageMeta | null> {
  try {
    const raw = await fs.readFile(metaPath(pishockUserId, kind), 'utf8');
    const parsed = JSON.parse(raw) as StoredImageMeta;
    if (!parsed?.contentType || !parsed.version) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getStoredProfileImage(
  pishockUserId: number,
  kind: ProfileImageKind,
): Promise<{ buffer: Buffer; contentType: string; version: string; updatedAt: string } | null> {
  const meta = await readMeta(pishockUserId, kind);
  if (!meta) return null;
  try {
    const buffer = await fs.readFile(binPath(pishockUserId, kind));
    if (!buffer.length) return null;
    return {
      buffer,
      contentType: meta.contentType,
      version: meta.version,
      updatedAt: meta.updatedAt,
    };
  } catch {
    return null;
  }
}

export async function localProfileUrls(pishockUserId: number): Promise<{
  avatarUrl: string | null;
  bannerUrl: string | null;
}> {
  const [avatar, banner] = await Promise.all([
    readMeta(pishockUserId, 'avatar'),
    readMeta(pishockUserId, 'banner'),
  ]);
  return {
    avatarUrl: avatar ? mediaPublicPath(pishockUserId, 'avatar', avatar.version) : null,
    bannerUrl: banner ? mediaPublicPath(pishockUserId, 'banner', banner.version) : null,
  };
}

async function writeStoredImage(
  pishockUserId: number,
  kind: ProfileImageKind,
  buffer: Buffer,
  contentType: string,
  source: string,
  version: string,
): Promise<string> {
  const dir = userDir(pishockUserId);
  await fs.mkdir(dir, { recursive: true });
  const meta: StoredImageMeta = {
    contentType,
    source,
    version,
    updatedAt: new Date().toISOString(),
    bytes: buffer.length,
  };
  const tmpBin = `${binPath(pishockUserId, kind)}.tmp`;
  const tmpMeta = `${metaPath(pishockUserId, kind)}.tmp`;
  await fs.writeFile(tmpBin, buffer);
  await fs.writeFile(tmpMeta, JSON.stringify(meta));
  await fs.rename(tmpBin, binPath(pishockUserId, kind));
  await fs.rename(tmpMeta, metaPath(pishockUserId, kind));
  return mediaPublicPath(pishockUserId, kind, version);
}

function sniffContentType(buffer: Buffer, hinted?: string | null): string | null {
  const hint = String(hinted ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase();
  if (hint && ALLOWED_CONTENT_TYPES.has(hint)) {
    return hint === 'image/jpg' ? 'image/jpeg' : hint;
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return 'image/gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

async function fetchRemoteImage(sourceUrl: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const res = await fetch(sourceUrl, {
    method: 'GET',
    headers: { Accept: 'image/*,*/*;q=0.8' },
    redirect: 'follow',
  });
  if (!res.ok) {
    console.warn(`[pishock] profile image fetch ${res.status} for ${sourceUrl.slice(0, 120)}`);
    return null;
  }
  const len = Number(res.headers.get('content-length') ?? 0);
  if (Number.isFinite(len) && len > MAX_IMAGE_BYTES) {
    console.warn(`[pishock] profile image too large (${len})`);
    return null;
  }
  const ab = await res.arrayBuffer();
  if (ab.byteLength > MAX_IMAGE_BYTES) {
    console.warn(`[pishock] profile image too large (${ab.byteLength})`);
    return null;
  }
  const buffer = Buffer.from(ab);
  const contentType = sniffContentType(buffer, res.headers.get('content-type'));
  if (!contentType) {
    console.warn(`[pishock] unsupported profile image type for ${sourceUrl.slice(0, 120)}`);
    return null;
  }
  return { buffer, contentType };
}

function decodeDataUrl(source: string): { buffer: Buffer; contentType: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(source);
  if (!match) return null;
  const contentType = sniffContentType(Buffer.alloc(0), match[1]) ?? match[1].toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(contentType) && contentType !== 'image/jpeg') return null;
  try {
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return null;
    const sniffed = sniffContentType(buffer, contentType);
    if (!sniffed) return null;
    return { buffer, contentType: sniffed };
  } catch {
    return null;
  }
}

async function storeOne(
  pishockUserId: number,
  kind: ProfileImageKind,
  source: string | null | undefined,
): Promise<string | null> {
  const raw = String(source ?? '').trim();
  if (!raw) {
    const existing = await readMeta(pishockUserId, kind);
    return existing ? mediaPublicPath(pishockUserId, kind, existing.version) : null;
  }

  const version = versionFromSource(raw);
  const existing = await readMeta(pishockUserId, kind);
  if (existing && existing.version === version && existing.source === raw) {
    try {
      await fs.access(binPath(pishockUserId, kind));
      return mediaPublicPath(pishockUserId, kind, existing.version);
    } catch {
      // re-download
    }
  }

  let payload: { buffer: Buffer; contentType: string } | null = null;
  if (raw.startsWith('data:')) {
    payload = decodeDataUrl(raw);
  } else if (/^https?:\/\//i.test(raw)) {
    payload = await fetchRemoteImage(raw);
  }
  if (!payload) {
    return existing ? mediaPublicPath(pishockUserId, kind, existing.version) : null;
  }

  try {
    return await writeStoredImage(
      pishockUserId,
      kind,
      payload.buffer,
      payload.contentType,
      raw,
      version,
    );
  } catch (err) {
    console.warn(
      `[pishock] failed to store ${kind} for ${pishockUserId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return existing ? mediaPublicPath(pishockUserId, kind, existing.version) : null;
  }
}

/** Download remote/base64 PiShock Images and rewrite profile URLs to local media paths. */
export async function persistAccountImages(
  pishockUserId: number,
  profile: PiShockAccountProfile,
): Promise<PiShockAccountProfile> {
  if (!(pishockUserId > 0)) return profile;
  const [avatarUrl, bannerUrl] = await Promise.all([
    storeOne(pishockUserId, 'avatar', profile.avatarUrl),
    storeOne(pishockUserId, 'banner', profile.bannerUrl),
  ]);
  return {
    username: profile.username,
    avatarUrl,
    bannerUrl,
  };
}

export async function deleteStoredProfileImages(pishockUserId: number): Promise<void> {
  if (!(pishockUserId > 0)) return;
  try {
    await fs.rm(userDir(pishockUserId), { recursive: true, force: true });
  } catch {
    // ignore
  }
}
