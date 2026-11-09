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
const token = decrypt(keyHex, row.encryptedToken, row.tokenIv, row.tokenAuthTag);
const userId = row.pishockUserId;
const auth = {
  Accept: 'application/json',
  'X-PiShock-UserId': String(userId),
  'X-PiShock-Token': token,
};

async function get(url) {
  const res = await fetch(url, { headers: auth });
  const text = await res.text();
  console.log('GET', url, res.status, text.slice(0, 160));
  return text ? JSON.parse(text) : null;
}

async function getBad(url) {
  const res = await fetch(url, {
    headers: { ...auth, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  console.log('GET+CT', url, res.status, text.slice(0, 160));
}

await getBad('https://api.pishock.com/Shockers');
const shockers = await get('https://api.pishock.com/Shockers');
const shared = await get('https://api.pishock.com/Share/GetShared');

const shockerId = shockers?.[0]?.ShockerId ?? shockers?.[0]?.Id;
console.log('using shocker', shockerId);

const body = {
  AgentName: 'Discord PiShock Activity',
  Operation: 1,
  Intensity: 20,
  Duration: 1000,
  IntensityAsPercentage: true,
};
const res = await fetch(`https://api.pishock.com/Shockers/OperateById/${shockerId}`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const text = await res.text();
console.log('OperateById vibrate', res.status, text.slice(0, 200));

const logs = await prisma.commandLog.findMany({
  orderBy: { createdAt: 'desc' },
  take: 10,
});
console.log(
  'recent commands',
  logs.map((l) => ({
    action: l.action,
    shockerId: l.shockerId,
    intensity: l.intensity,
    durationMs: l.durationMs,
    success: l.success,
    detail: l.detail,
  })),
);

await prisma.$disconnect();
