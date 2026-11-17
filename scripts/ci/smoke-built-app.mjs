// CI smoke test for the production build: boots `node dist/server.js` and checks that the
// client is actually served — index.html, every JS/CSS asset it references, fonts referenced
// by the CSS, SPA fallback, API 404s, security headers — then that SIGTERM shuts down cleanly.
import { spawn } from 'node:child_process';

const PORT = Number(process.env.SMOKE_PORT ?? 3999);
const base = `http://127.0.0.1:${PORT}`;
const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

const server = spawn(process.execPath, ['dist/server.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://smoke:smoke@127.0.0.1:1/smoke',
    DISCORD_CLIENT_ID: 'smoke',
    DISCORD_CLIENT_SECRET: 'smoke',
    TOKEN_KEY: '0'.repeat(64),
    PUBLIC_URL: base,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
server.stdout.on('data', (d) => (logs += d));
server.stderr.on('data', (d) => (logs += d));
const exited = new Promise((resolve) => server.on('exit', (code, signal) => resolve({ code, signal })));

async function waitForHealth(timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return true;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

try {
  check(await waitForHealth(), 'server boots and /api/health responds');

  const index = await fetch(`${base}/`);
  const html = await index.text();
  check(index.status === 200, `GET / → 200 (got ${index.status})`);
  check(/text\/html/.test(index.headers.get('content-type') ?? ''), 'GET / is text/html');
  check(html.includes('<div id="root">'), 'index.html contains the React root');
  check(
    Boolean(index.headers.get('content-security-policy') ?? index.headers.get('content-security-policy-report-only')),
    'CSP header present',
  );
  check(!index.headers.get('x-frame-options'), 'no X-Frame-Options (would block the Discord iframe)');
  check(/discord/.test(index.headers.get('content-security-policy-report-only') ?? index.headers.get('content-security-policy') ?? ''), 'CSP frame-ancestors allows Discord');

  const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
  check(assets.some((a) => a.endsWith('.js')), 'index.html references a JS bundle');
  check(assets.some((a) => a.endsWith('.css')), 'index.html references a stylesheet');
  const fonts = new Set();
  for (const asset of assets) {
    const res = await fetch(`${base}${asset}`);
    const type = res.headers.get('content-type') ?? '';
    const body = await res.text();
    check(res.status === 200 && body.length > 0, `${asset} → 200 (got ${res.status})`);
    if (asset.endsWith('.js')) check(/javascript/.test(type), `${asset} served as JavaScript`);
    if (asset.endsWith('.css')) {
      check(/css/.test(type), `${asset} served as CSS`);
      for (const m of body.matchAll(/url\((?:'|")?(\/fonts\/[^)'"?#]+)/g)) fonts.add(m[1]);
    }
  }
  for (const font of fonts) {
    const res = await fetch(`${base}${font}`);
    await res.arrayBuffer();
    check(res.status === 200, `font ${font} → 200 (got ${res.status})`);
  }

  const deep = await fetch(`${base}/some/client/route`);
  check(deep.status === 200 && (await deep.text()).includes('<div id="root">'), 'SPA fallback serves index.html');
  const missingApi = await fetch(`${base}/api/does-not-exist`);
  // Auth / version checks may answer first (401/426); what matters is it's a JSON error, not HTML.
  check(
    missingApi.status >= 400 && /json/.test(missingApi.headers.get('content-type') ?? ''),
    `unknown /api path is a JSON error, not the SPA (got ${missingApi.status})`,
  );
  const missingAsset = await fetch(`${base}/assets/does-not-exist.js`);
  check(missingAsset.status === 404, `missing asset → 404, not index.html (got ${missingAsset.status})`);
} finally {
  server.kill('SIGTERM');
  const timeout = new Promise((r) => setTimeout(() => r({ code: 'timeout' }), 10_000));
  const { code, signal } = await Promise.race([exited, timeout]);
  check(code === 0, `SIGTERM → graceful exit 0 (got ${code ?? signal})`);
}

if (failures.length) {
  console.error('\n--- server log ---\n' + logs.slice(-4000));
  for (const f of failures) console.error(`::error::smoke: ${f}`);
  process.exit(1);
}
console.log("\nSmoke test passed.");
