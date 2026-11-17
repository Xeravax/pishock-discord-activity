// CI: report client bundle sizes (to the GitHub job summary when available) and fail if the
// gzipped JS or CSS exceeds its budget. Budgets are ~35% above the current size, so this
// catches an accidental heavy dependency, not normal growth. Raise them deliberately.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const BUDGET_GZIP_BYTES = { js: 250 * 1024, css: 150 * 1024 };
const dir = path.resolve('client-dist/assets');

if (!fs.existsSync(dir)) {
  console.error('client-dist/assets not found — run `npm run build` first');
  process.exit(1);
}

const rows = fs
  .readdirSync(dir)
  .map((name) => {
    const buf = fs.readFileSync(path.join(dir, name));
    return { name, ext: path.extname(name).slice(1), raw: buf.length, gzip: zlib.gzipSync(buf).length };
  })
  .sort((a, b) => b.gzip - a.gzip);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const total = (ext) => rows.filter((r) => r.ext === ext).reduce((sum, r) => sum + r.gzip, 0);

const lines = [
  '### Client bundle',
  '',
  '| File | Raw | Gzip |',
  '| --- | ---: | ---: |',
  ...rows.map((r) => `| \`${r.name}\` | ${kb(r.raw)} | ${kb(r.gzip)} |`),
  '',
];
const failures = [];
for (const [ext, budget] of Object.entries(BUDGET_GZIP_BYTES)) {
  const size = total(ext);
  const ok = size <= budget;
  lines.push(`- ${ext.toUpperCase()} total (gzip): **${kb(size)}** / budget ${kb(budget)} ${ok ? '✅' : '❌'}`);
  if (!ok) failures.push(`${ext} bundle ${kb(size)} exceeds ${kb(budget)} gzip budget`);
}

const report = lines.join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
if (failures.length) {
  for (const f of failures) console.error(`::error::${f}`);
  process.exit(1);
}
