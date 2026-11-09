import { PrismaClient } from '@prisma/client';
import { createDecipheriv, createHash } from 'node:crypto';

const prisma = new PrismaClient();
const keyHex = process.env.TOKEN_KEY;

function keyFromEnv(tokenKey) {
  if (/^[0-9a-fA-F]{64}$/.test(tokenKey.trim())) return Buffer.from(tokenKey.trim(), 'hex');
  return createHash('sha256').update(tokenKey).digest();
}

function decrypt(tokenKey, encryptedToken, tokenIv, tokenAuthTag) {
  const key = keyFromEnv(tokenKey);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(tokenIv, 'base64'));
  decipher.setAuthTag(Buffer.from(tokenAuthTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedToken, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

const row = await prisma.piShockSession.findFirst();
if (!row) {
  console.log('NO_SESSION');
  process.exit(0);
}

const token = decrypt(keyHex, row.encryptedToken, row.tokenIv, row.tokenAuthTag);
console.log(
  JSON.stringify({
    userId: row.pishockUserId,
    tokenLen: token.length,
    tokenPrefix: token.slice(0, 8),
  }),
);

const headers = {
  Accept: 'application/json',
  'X-PiShock-UserId': String(row.pishockUserId),
  'X-PiShock-Token': token,
};

for (const url of [
  'https://api.pishock.com/Hub',
  'https://api.pishock.com/Shockers',
  'https://api.pishock.com/Share/GetShared',
  'https://api.pishock.com/Links',
]) {
  const res = await fetch(url, { headers });
  const body = await res.text();
  console.log(url, res.status, body.slice(0, 200));
}

await prisma.$disconnect();
