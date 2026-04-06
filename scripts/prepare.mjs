import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const distEntry = new URL('../dist/cli.js', import.meta.url);
const tscBin = new URL('../node_modules/typescript/bin/tsc', import.meta.url);

if (existsSync(tscBin)) {
  const result = spawnSync('npm', ['run', 'build'], {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  process.exit(0);
}

if (existsSync(distEntry)) {
  console.log('bbcli prepare: using committed dist/ because TypeScript build dependencies are unavailable.');
  process.exit(0);
}

console.error('bbcli prepare: dist/ is missing and TypeScript is unavailable. Run `npm install` and `npm run build` before packaging.');
process.exit(1);
