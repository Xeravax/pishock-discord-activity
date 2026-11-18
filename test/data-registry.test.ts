import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  USER_DATA_MODELS,
  normalizeRetentionDays,
  stripSecrets,
} from '../src/server/data-registry.js';

/** Models in schema.prisma that hold data about a Discord user. */
function modelsWithUserData(schema: string): string[] {
  const out: string[] = [];
  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const [, name, body] = match;
    if (
      name === 'DiscordUser' ||
      /\bDiscordUser\b/.test(body!) ||
      /discordUserId|DiscordUserId/.test(body!)
    ) {
      out.push(name!);
    }
  }
  return out;
}

describe('data registry', () => {
  it('covers every model that stores data about a user', () => {
    const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
    const found = modelsWithUserData(schema);
    assert.ok(found.length >= 7, 'schema parse sanity');
    const missing = found.filter((m) => !(m in USER_DATA_MODELS));
    assert.deepEqual(missing, [], `register these in USER_DATA_MODELS: ${missing.join(', ')}`);
  });

  it('never exports secrets', () => {
    const row = stripSecrets({
      pishockUsername: 'me',
      encryptedToken: 'x',
      tokenIv: 'y',
      tokenAuthTag: 'z',
      apiKeyHash: 'h',
    });
    assert.deepEqual(row, { pishockUsername: 'me' });
  });

  it('accepts only the offered retention choices', () => {
    assert.equal(normalizeRetentionDays(30), 30);
    assert.equal(normalizeRetentionDays('365'), 365);
    assert.equal(normalizeRetentionDays(null), null);
    assert.equal(normalizeRetentionDays(7), undefined);
    assert.equal(normalizeRetentionDays('forever'), undefined);
  });
});
