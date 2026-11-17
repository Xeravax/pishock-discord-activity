import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { buildLoggerOptions, rateLimitKey, redactQueryTokens, registerSecurity, strictRateLimit } from '../src/server/security.js';
import type { AppEnv } from '../src/server/env.js';

const req = (headers: Record<string, string>, ip = '203.0.113.9') =>
  ({ headers, ip }) as unknown as FastifyRequest;

test('redactQueryTokens strips legacy ws token query params', () => {
  assert.equal(redactQueryTokens('/api/ws?token=abc123'), '/api/ws?token=[redacted]');
  assert.equal(
    redactQueryTokens('/api/ws?x=1&access_token=abc&y=2'),
    '/api/ws?x=1&access_token=[redacted]&y=2',
  );
  assert.equal(redactQueryTokens('/api/me'), '/api/me');
  assert.equal(redactQueryTokens(undefined), undefined);
});

test('logger request serializer never emits the token or headers', () => {
  const { serializers } = buildLoggerOptions();
  const out = serializers.req({
    method: 'GET',
    url: '/api/ws?token=SECRET',
    headers: { authorization: 'Bearer SECRET', host: 'example.test' },
    ip: '1.2.3.4',
  });
  assert.ok(!JSON.stringify(out).includes('SECRET'));
  assert.equal(out.host, 'example.test');
});

test('rateLimitKey buckets by bearer when present, never leaks the token, else by IP', () => {
  const a = rateLimitKey(req({ authorization: 'Bearer token-a' }));
  const b = rateLimitKey(req({ authorization: 'Bearer token-b' }));
  assert.notEqual(a, b);
  assert.ok(!a.includes('token-a'));
  assert.equal(a, rateLimitKey(req({ authorization: 'Bearer token-a' }, '198.51.100.1')));
  assert.equal(rateLimitKey(req({})), 'ip:203.0.113.9');
});

test('redactQueryTokens matches percent-encoded and +-encoded names, keeping the raw name', () => {
  assert.equal(redactQueryTokens('/api/ws?%74oken=SECRET'), '/api/ws?%74oken=[redacted]');
  assert.equal(
    redactQueryTokens('/api/ws?access%5Ftoken=SECRET&x=1'),
    '/api/ws?access%5Ftoken=[redacted]&x=1',
  );
  assert.equal(redactQueryTokens('/api/ws?TOKEN=SECRET'), '/api/ws?TOKEN=[redacted]');
  // Values that merely contain "token", and names that are not exactly token, are left alone.
  assert.equal(redactQueryTokens('/api/x?q=token=1&mytoken=2'), '/api/x?q=token=1&mytoken=2');
  assert.equal(redactQueryTokens('/api/ws?token=a#frag'), '/api/ws?token=[redacted]#frag');
});

test('redactQueryTokens never throws on malformed percent-encoding', () => {
  assert.equal(redactQueryTokens('/api/ws?%E0%A4%A=1&token=S'), '/api/ws?%E0%A4%A=1&token=[redacted]');
  assert.equal(redactQueryTokens('/api/ws?%=1&%zz=2'), '/api/ws?%=1&%zz=2');
});

test('strictRateLimit byIp: rotating Authorization headers cannot create new buckets', async () => {
  const app = Fastify();
  await registerSecurity(app, { rateLimitMax: 1000, cspEnforce: false } as AppEnv);
  app.post('/api/auth/discord', strictRateLimit(2, { byIp: true }), async () => ({ ok: true }));
  const codes: number[] = [];
  for (let i = 0; i < 4; i++) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/discord',
      headers: { authorization: `Bearer made-up-${i}` },
    });
    codes.push(res.statusCode);
  }
  assert.deepEqual(codes, [200, 200, 429, 429]);
  await app.close();
});
