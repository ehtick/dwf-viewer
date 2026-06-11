import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'demo-dist');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(path.join(root, 'dist'), path.join(out, 'dist'), { recursive: true });
await cp(path.join(root, 'public'), path.join(out, 'public'), { recursive: true });
await cp(path.join(root, 'examples'), path.join(out, 'examples'), { recursive: true });
await cp(path.join(root, 'styles'), path.join(out, 'styles'), { recursive: true });
let html = await readFile(path.join(root, 'demo/index.html'), 'utf8');
html = html.replaceAll('../styles/', './styles/').replace('./app.js', './app.js');
await writeFile(path.join(out, 'index.html'), html);
let app = await readFile(path.join(root, 'demo/app.js'), 'utf8');
app = app
  .replaceAll("'../dist/index.js?v=0.5.0'", `'./dist/index.js?v=${pkg.version}'`)
  .replaceAll("wasmUrl: '../public/dwfv-render.wasm'", "wasmUrl: './public/dwfv-render.wasm'")
  .replaceAll("fetch('../examples/manifest.json'", "fetch('./examples/manifest.json'")
  .replaceAll('`../examples/${demo.path}`', '`./examples/${demo.path}`');
await writeFile(path.join(out, 'app.js'), app);
await writeFile(path.join(out, '_headers'), `/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer-when-downgrade\n/public/*.wasm\n  Content-Type: application/wasm\n  Cache-Control: public, max-age=31536000, immutable\n/dist/*\n  Cache-Control: public, max-age=31536000, immutable\n/examples/*\n  Cache-Control: public, max-age=3600\n`);
console.log(`Demo built at ${path.relative(root, out)}`);
