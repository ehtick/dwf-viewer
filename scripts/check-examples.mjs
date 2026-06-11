import crypto from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const dir = path.resolve('examples');
const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
const seenIds = new Set();
const seenPaths = new Set();
for (const item of manifest) {
  if (!item.id || seenIds.has(item.id)) throw new Error(`Duplicate or empty example id: ${item.id}`);
  if (!item.path || seenPaths.has(item.path)) throw new Error(`Duplicate or empty example path: ${item.path}`);
  seenIds.add(item.id);
  seenPaths.add(item.path);
  await readFile(path.join(dir, item.path));
}
const entries = (await readdir(dir)).filter(f => f !== 'manifest.json');
for (const entry of entries) {
  if (!seenPaths.has(entry)) throw new Error(`Example file is not listed in manifest.json: ${entry}`);
}
const byHash = new Map();
for (const entry of entries) {
  const bytes = await readFile(path.join(dir, entry));
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const first = byHash.get(hash);
  if (first) throw new Error(`Duplicate example payload: ${first} and ${entry}`);
  byHash.set(hash, entry);
}
console.log(`Examples OK: ${entries.length} file(s), ${manifest.length} manifest item(s), no duplicate payloads.`);
