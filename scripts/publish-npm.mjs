import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const KNOWN_PACKAGES = new Set(['dwf-viewer', '@flyfish-dev/dwf-viewer']);
const DEFAULT_PACKAGES = ['dwf-viewer', '@flyfish-dev/dwf-viewer'];

const rawArgs = process.argv.slice(2);
const packageNames = rawArgs.filter(arg => !arg.startsWith('-'));
const flags = rawArgs.filter(arg => arg.startsWith('-'));
const targets = packageNames.length > 0 ? packageNames : DEFAULT_PACKAGES;

for (const name of targets) {
  if (!KNOWN_PACKAGES.has(name)) {
    throw new Error(`Refusing to publish unexpected package name: ${name}`);
  }
}

const dryRun = flags.includes('--dry-run');
const provenance = flags.includes('--provenance') || process.env.NPM_CONFIG_PROVENANCE === 'true';
const extraPublishArgs = collectForwardedPublishArgs(flags);
const packageJsonPath = 'package.json';
const originalText = await readFile(packageJsonPath, 'utf8');
const originalPackage = JSON.parse(originalText);

if (originalPackage.name !== 'dwf-viewer') {
  throw new Error(`Expected package.json name to be "dwf-viewer", got "${originalPackage.name}".`);
}

try {
  run('npm', ['run', 'build']);
  run('npm', ['run', 'validate:production']);
  run('npm', ['run', 'check:package']);

  for (const name of targets) {
    const nextPackage = { ...originalPackage, name };
    await writeFile(packageJsonPath, `${JSON.stringify(nextPackage, null, 2)}\n`);

    const publishArgs = [
      'publish',
      '--access',
      'public',
      '--registry',
      'https://registry.npmjs.org',
      '--ignore-scripts',
      provenance ? '--provenance' : '--provenance=false',
      ...extraPublishArgs
    ];
    if (dryRun) publishArgs.push('--dry-run');

    run('npm', publishArgs);
  }
} finally {
  await writeFile(packageJsonPath, originalText);
}

function collectForwardedPublishArgs(flags) {
  const out = [];
  for (const flag of flags) {
    if (flag === '--dry-run' || flag === '--provenance') continue;
    if (flag.startsWith('--tag=') || flag.startsWith('--otp=')) out.push(flag);
  }
  return out;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
  }
}
