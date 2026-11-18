// Runs after `vite build` + `tsc`: places the entry shim and build metadata next to the
// compiled server so `node dist/server.js` (and the Docker image) can find them.
import fs from 'node:fs';

const copies = [
  ['src/server.js', 'dist/server.js', true],
  ['version.json', 'dist/version.json', true],
  ['version.json', 'client-dist/version.json', true],
  ['release-notes.json', 'dist/release-notes.json', false],
];

for (const [from, to, required] of copies) {
  if (!fs.existsSync(from)) {
    if (required) {
      console.error(`postbuild: missing required file ${from}`);
      process.exit(1);
    }
    continue;
  }
  fs.copyFileSync(from, to);
}
