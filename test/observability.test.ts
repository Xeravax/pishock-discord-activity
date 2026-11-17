import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import { registerObservability } from '../src/server/observability.js';

function appWith() {
  const app = Fastify();
  registerObservability(app);
  app.get('/boom', async () => {
    throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2');
  });
  app.get('/bad', async () => {
    const err = new Error('nope') as Error & { statusCode: number };
    err.statusCode = 400;
    throw err;
  });
  app.get('/ok', async () => ({ ok: true }));
  return app;
}

describe('observability', () => {
  it('5xx hides internal details but exposes a request id', async () => {
    const res = await appWith().inject({ method: 'GET', url: '/boom' });
    assert.equal(res.statusCode, 500);
    const body = res.json() as { error: string; requestId: string };
    assert.equal(body.error, 'Internal server error');
    assert.ok(body.requestId);
    assert.ok(!res.body.includes('hunter2') && !res.body.includes('ECONNREFUSED'));
    assert.equal(res.headers['x-request-id'], body.requestId);
  });

  it('4xx keeps its message', async () => {
    const res = await appWith().inject({ method: 'GET', url: '/bad' });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as { error: string }).error, 'nope');
  });

  it('adds X-Request-Id to normal responses', async () => {
    const res = await appWith().inject({ method: 'GET', url: '/ok' });
    assert.ok(res.headers['x-request-id']);
  });
});
