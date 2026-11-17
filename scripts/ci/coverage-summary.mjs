// CI: append the client coverage totals to the GitHub job summary (report only, no threshold).
import fs from 'node:fs';

const file = 'coverage/client/coverage-summary.json';
if (!fs.existsSync(file)) {
  console.log(`${file} not found; skipping coverage summary`);
  process.exit(0);
}
const { total } = JSON.parse(fs.readFileSync(file, 'utf8'));
const row = (k) => `| ${k} | ${total[k].pct}% | ${total[k].covered}/${total[k].total} |`;
const report = [
  '### Client test coverage',
  '',
  '| Metric | % | Covered |',
  '| --- | ---: | ---: |',
  ...['lines', 'statements', 'branches', 'functions'].map(row),
  '',
].join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
