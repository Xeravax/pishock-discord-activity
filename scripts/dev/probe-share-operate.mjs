import { PrismaClient } from '@prisma/client';
import { createDecipheriv } from 'node:crypto';

const prisma = new PrismaClient();
const key = Buffer.from(process.env.TOKEN_KEY, 'hex');
const row = await prisma.piShockSession.findFirst();
const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(row.tokenIv, 'base64'));
decipher.setAuthTag(Buffer.from(row.tokenAuthTag, 'base64'));
const token = Buffer.concat([
  decipher.update(Buffer.from(row.encryptedToken, 'base64')),
  decipher.final(),
]).toString('utf8');

const authGet = {
  Accept: 'application/json',
  'X-PiShock-UserId': String(row.pishockUserId),
  'X-PiShock-Token': token,
};
const authPost = { ...authGet, 'Content-Type': 'application/json' };

const shared = await (await fetch('https://api.pishock.com/Share/GetShared', { headers: authGet })).json();
const s = shared[0];
console.log('share', {
  id: s.Id,
  code: s.ShareCode,
  clientId: s.ClientId,
  paused: s.Paused,
  sharePaused: s.SharePaused,
});

for (const [label, duration] of [
  ['ms1000', 1000],
  ['sec1', 1],
]) {
  const body = {
    AgentName: 'Discord PiShock Activity',
    Operation: 1,
    Intensity: 15,
    Duration: duration,
    IntensityAsPercentage: true,
  };
  const res = await fetch(
    `https://api.pishock.com/Shockers/OperateByShare/${encodeURIComponent(s.ShareCode)}`,
    { method: 'POST', headers: authPost, body: JSON.stringify(body) },
  );
  console.log('OperateByShare', label, res.status, await res.text());
}

await prisma.$disconnect();
