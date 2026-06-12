import { DwfViewer } from '../dist/index.js?v=0.6.1';

const $ = (id) => document.getElementById(id);
const DEFAULT_DEMO_ID = 'blocks-tables-2d';
const viewer = new DwfViewer($('viewer'), {
  wasmUrl: '../public/dwfv-render.wasm',
  preferWebgl: true,
  preferWasm: true,
  maxDevicePixelRatio: 1.5,
  maxCanvasPixels: 12_000_000,
  maxGpuCacheBytes: 192 * 1024 * 1024,
  maxCachedScenes: 4,
  lineWeightMode: 'adaptive',
  minStrokeCssPx: 0.42,
  minTextCssPx: 1.05,
  maxOverviewStrokeCssPx: 0.9,
  minFilledAreaCssPx: 0.04
});

let demos = [];

async function loadManifest() {
  const res = await fetch('../examples/manifest.json', { cache: 'no-store' });
  demos = await res.json();
  const select = $('demoSelect');
  select.replaceChildren();
  for (const demo of demos) {
    const option = document.createElement('option');
    option.value = demo.id;
    option.textContent = demo.title;
    select.append(option);
  }
  select.value = demos.some(d => d.id === DEFAULT_DEMO_ID) ? DEFAULT_DEMO_ID : (demos[0]?.id ?? '');
  select.addEventListener('change', updateHint);
  updateHint();
}

function selectedDemo() {
  return demos.find(d => d.id === $('demoSelect').value) ?? demos[0];
}

function updateHint() {
  const demo = selectedDemo();
  $('demoHint').textContent = demo?.description ?? '';
}

async function loadDemo(demo = selectedDemo()) {
  if (!demo) return;
  const res = await fetch(`../examples/${demo.path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch ${demo.path}: HTTP ${res.status}`);
  await viewer.load(await res.arrayBuffer(), {
    fileName: demo.path,
    preferWebgl: $('webgl').checked,
    preferWasm: $('wasm').checked,
    lineWeightMode: $('lineMode').value,
    pageIndex: demo.pageIndex ?? 0
  });
}

$('file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  await viewer.load(file, { preferWebgl: $('webgl').checked, preferWasm: $('wasm').checked, lineWeightMode: $('lineMode').value });
});
$('loadDemo').addEventListener('click', () => loadDemo().catch(err => alert(String(err))));
$('fit').addEventListener('click', () => viewer.fit());
$('webgl').addEventListener('change', event => viewer.setPreferWebgl(event.target.checked));
$('wasm').addEventListener('change', event => viewer.setPreferWasm(event.target.checked));
$('lineMode').addEventListener('change', event => viewer.setLineWeightMode(event.target.value));

await loadManifest();
await loadDemo(selectedDemo());
