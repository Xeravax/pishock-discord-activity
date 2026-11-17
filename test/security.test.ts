import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FastifyRequest } from 'fastify';
import { buildLoggerOptions, rateLimitKey, redactQueryTokens } from '../src/server/security.js';

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
