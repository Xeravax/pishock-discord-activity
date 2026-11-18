import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Structural safety invariants. These read the server source (comments stripped) and fail
 * when a code path that can fire a PiShock device appears without the safety gates, or
 * when a *new* firing path appears at all — forcing a deliberate review and an update here.
 */

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/server');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const files = new Map(
  walk(SERVER_DIR).map((f) => [path.relative(SERVER_DIR, f), stripComments(fs.readFileSync(f, 'utf8'))]),
);

/** Calls that put a command on the wire to a device (definitions excluded by the `(`-call form). */
const FIRING = /(?<!function\s)\b(publishOperate|operateById|operateByShare)\s*\(|\bcommandQueue\.enqueue\s*\(/;
const FIRING_G = new RegExp(FIRING.source, 'g');

/** Files allowed to contain a firing call. Adding to this list needs a safety review. */
const FIRING_FILES = new Set([
  'routes/control.ts',
  'routes/participants.ts',
  'pishock/command-queue-runtime.ts',
  'pishock/shock-warning.ts', // takes publishOperate as an injected dependency
  'operate-policy.ts', // hold auto-end / shutdown flush: only sends *end* frames
]);

type RouteChunk = { method: string; url: string; file: string; text: string };

function routeChunks(): RouteChunk[] {
  const chunks: RouteChunk[] = [];
  for (const [file, src] of files) {
    if (!file.startsWith('routes/')) continue;
    const re = /app\.(get|post|put|delete|patch)\(\s*'([^']+)'/g;
    const hits = [...src.matchAll(re)];
    hits.forEach((m, i) => {
      const end = hits[i + 1]?.index ?? src.length;
      chunks.push({
        method: m[1]!.toUpperCase(),
        url: m[2]!,
        file,
        text: src.slice(m.index, end),
      });
    });
  }
  return chunks;
}

const needs = (text: string, markers: string[]) =>
  markers.filter((m) => !new RegExp(`\\b${m}\\b`).test(text));

describe('device-firing code paths', () => {
  it('route discovery works (guards against the parser silently matching nothing)', () => {
    const chunks = routeChunks();
    assert.ok(chunks.length >= 25, `expected many routes, found ${chunks.length}`);
    assert.ok(chunks.some((c) => c.url === '/api/operate'));
  });

  it('only the reviewed files may fire a device', () => {
    const offenders = [...files]
      .filter(([file, src]) => FIRING.test(src) && !FIRING_FILES.has(file))
      // broker.ts / client.ts only *define* the primitives
      .filter(([file]) => !['pishock/broker.ts', 'pishock/client.ts'].includes(file))
      .map(([file]) => file);
    assert.deepEqual(offenders, [], 'new file fires devices — review gates, then allowlist it');
  });

  it('exactly the expected routes fire devices', () => {
    const firing = routeChunks()
      .filter((c) => FIRING_G.test(c.text) && ((FIRING_G.lastIndex = 0), true))
      .map((c) => `${c.method} ${c.url}`)
      .sort();
    assert.deepEqual(firing, [
      'POST /api/operate',
      'POST /api/participants/:targetDiscordUserId/operate',
      'PUT /api/emergency-stop',
    ]);
  });

  const find = (method: string, url: string) => {
    const c = routeChunks().find((r) => r.method === method && r.url === url);
    assert.ok(c, `${method} ${url} not found`);
    return c;
  };

  it('POST /api/operate applies consent, rate limit, policy, mode, ceilings and clamps', () => {
    const c = find('POST', '/api/operate');
    assert.deepEqual(
      needs(c.text, [
        'requireSession', // consent + PiShock login
        'assertOperateRateLimit',
        'resolveOwnOperatePolicy', // device ceilings, personal bands, e-stop, pause
        'assertModeAllowed',
        'assertWithinCeilings',
        'clampIntensity',
        'clampDurationMs',
      ]),
      [],
    );
  });

  it('POST /api/participants/:id/operate applies every cross-user gate', () => {
    const c = find('POST', '/api/participants/:targetDiscordUserId/operate');
    assert.deepEqual(
      needs(c.text, [
        'hasConsent', // caller consent
        'getConsent', // target consent
        'verifyActivityInstance', // both users really share this Activity
        'isExecutorBanned',
        'isEmergencyStopped',
        'shockerPauseBlocks',
        'assertOperateRateLimit',
        'assertModeAllowed',
        'assertWithinCeilings',
        'clampIntensity',
        'clampDurationMs',
      ]),
      [],
    );
  });

  it('PUT /api/emergency-stop requires an authenticated session and ownership check', () => {
    const c = find('PUT', '/api/emergency-stop');
    assert.deepEqual(needs(c.text, ['requireSession', 'findShockerInSnapshot']), []);
  });

  it('queued commands are re-validated at execution time, not only at enqueue time', () => {
    const src = files.get('pishock/command-queue-runtime.ts')!;
    const fn = (name: string) => {
      const start = src.indexOf(`async function ${name}`);
      assert.ok(start >= 0, `${name} not found`);
      const next = src.indexOf('\nasync function ', start + 10);
      return src.slice(start, next < 0 ? undefined : next);
    };
    // Right before running: consent, e-stop, ban, PiShock pause.
    assert.deepEqual(
      needs(fn('validateQueuedItem'), [
        'getConsent',
        'isEmergencyStopped',
        'isExecutorBanned',
        'shockerPauseBlocks',
      ]),
      [],
    );
    // Limits may have been lowered while the item waited: ceilings are re-checked on the
    // values actually sent, immediately before publish.
    const exec = fn('executeQueuedItem');
    assert.deepEqual(needs(exec, ['assertWithinCeilings']), []);
    assert.ok(exec.indexOf('assertWithinCeilings') < exec.indexOf('publishOperate('));
  });

  it('server-built commands (roulette) pass the wearer gates and take the queued path', () => {
    // Reviewed firing path: roulette results are built server-side and sent through
    // submitServerCommand, which only enqueues or runs validateQueuedItem → executeQueuedItem.
    const runtime = files.get('pishock/command-queue-runtime.ts')!;
    const start = runtime.indexOf('export async function submitServerCommand');
    assert.ok(start >= 0, 'submitServerCommand not found');
    const body = runtime.slice(start);
    assert.deepEqual(
      needs(body, ['commandQueue.enqueue', 'validateQueuedItem', 'executeQueuedItem']),
      [],
    );
    assert.ok(body.indexOf('validateQueuedItem') < body.indexOf('executeQueuedItem'));
    assert.doesNotMatch(body, /\b(publishOperate|operateById|operateByShare)\s*\(/);

    // Only the roulette route may call it, after the wearer's gates (incl. approve-each).
    const callers = [...files]
      .filter(([file, src]) => file !== 'pishock/command-queue-runtime.ts' && /\bsubmitServerCommand\s*\(/.test(src))
      .map(([file]) => file);
    assert.deepEqual(callers, ['routes/roulette.ts']);
    const roulette = files.get('routes/roulette.ts')!;
    assert.deepEqual(needs(roulette, ['getConsent', 'isExecutorBanned', 'rouletteAllowed']), []);
    assert.ok(roulette.indexOf('admitWearerCommand(') < roulette.indexOf('submitServerCommand('));
  });

  it('operate-policy only ever publishes an *end* frame (hold auto-end / shutdown flush)', () => {
    const src = files.get('operate-policy.ts')!;
    const start = src.indexOf('const sendEnd');
    assert.ok(start >= 0, 'sendEnd not found');
    const frame = src.slice(start, src.indexOf('};', start));
    assert.match(frame, /operation: 'e'/);
    assert.match(frame, /end: true/);
    assert.match(frame, /intensity: 0/);
    assert.equal(src.match(/\bpublish\(creds/g)?.length, 1, 'unexpected extra publish call');
    // Only the injected end-frame callback may publish: no direct firing primitives here.
    assert.equal(
      FIRING.test(src),
      false,
      'operate-policy must not call publishOperate/operateById/operateByShare directly',
    );
  });

  it('operate routes re-check the e-stop synchronously right before each device command', () => {
    for (const [method, url] of [
      ['POST', '/api/operate'],
      ['POST', '/api/participants/:targetDiscordUserId/operate'],
    ] as const) {
      const text = find(method, url).text;
      const commands = [...text.matchAll(/await (publishOperate|operateById|operateByShare)\(/g)];
      for (const m of commands) {
        const before = text.slice(0, m.index);
        // End frames (operation: 'e') never need the guard.
        const call = text.slice(m.index, text.indexOf(');', m.index));
        if (/operation: 'e'/.test(call)) continue;
        const lastGuard = before.lastIndexOf('isEmergencyStopLatched(');
        const lastAwait = before.lastIndexOf('await ');
        assert.ok(
          lastGuard >= 0 && lastGuard > lastAwait,
          `${method} ${url}: ${m[1]} needs isEmergencyStopLatched() after the last await`,
        );
      }
    }
  });
});
