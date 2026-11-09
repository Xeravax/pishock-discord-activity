import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function keyFromEnv(tokenKey: string): Buffer {
  const trimmed = tokenKey.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  try {
    const b64 = Buffer.from(trimmed, 'base64');
    if (b64.length === 32) return b64;
  } catch {
    // fall through
  }
  return createHash('sha256').update(trimmed).digest();
}

export function encryptToken(tokenKey: string, plaintext: string) {
  const key = keyFromEnv(tokenKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedToken: encrypted.toString('base64'),
    tokenIv: iv.toString('base64'),
    tokenAuthTag: authTag.toString('base64'),
  };
}

export function decryptToken(
  tokenKey: string,
  encryptedToken: string,
  tokenIv: string,
  tokenAuthTag: string,
): string {
  const key = keyFromEnv(tokenKey);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(tokenIv, 'base64'));
  decipher.setAuthTag(Buffer.from(tokenAuthTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedToken, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
