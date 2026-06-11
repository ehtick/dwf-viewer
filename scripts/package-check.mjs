import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const required = [
  'dist/index.js',
  'dist/index.d.ts',
  'public/dwfv-render.wasm',
  'styles/dwf-viewer.css',
  'README.md',
  'LICENSE',
  'NOTICE',
  'package.json'
];
for (const file of required) {
  if (!existsSync(file)) throw new Error(`Missing required publish artifact: ${file}`);
}
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (pkg.private) throw new Error('package.json must not be private for npm publishing.');
if (!['dwf-viewer', '@flyfish-dev/dwf-viewer'].includes(pkg.name)) throw new Error(`Unexpected package name for publishing: ${pkg.name}`);
if (pkg.license !== 'AGPL-3.0-only') throw new Error(`Expected AGPL-3.0-only license, got: ${pkg.license}`);
if (!pkg.exports?.['.']?.import || !pkg.exports?.['.']?.types) throw new Error('package.json exports must define import and types for root entry.');
if (!Array.isArray(pkg.files) || !pkg.files.includes('dist')) throw new Error('package.json files must include dist.');
if (!pkg.files.includes('NOTICE')) throw new Error('package.json files must include NOTICE.');
execFileSync(process.execPath, ['scripts/check-examples.mjs'], { stdio: 'inherit' });
execFileSync('npm', ['pack', '--dry-run'], { stdio: 'inherit' });
