import { DwfViewer } from '../dist/index.js?v=0.6.1';

const $ = (id) => document.getElementById(id);
const DEFAULT_DEMO_ID = 'blocks-tables-2d';
const DEFAULT_LOCALE = 'en';
const STRINGS = {
  en: {
    tagline: "World's first open-source pure frontend DWF/DWFx preview component",
    loadSample: 'Load sample',
    fit: 'Fit',
    webgl: 'WebGL acceleration',
    wasm: 'WASM fallback',
    lineWeight: 'Line weight',
    language: 'Language',
    fileAria: 'Open local DWF or DWFx file',
    demoAria: 'Example file',
    fetchFailed: 'Failed to fetch',
    lineModes: {
      adaptive: 'CAD adaptive',
      hairline: 'Hairline',
      physical: 'Physical'
    }
  },
  zh: {
    tagline: '世界首个开源纯前端 DWF/DWFx 预览组件',
    loadSample: '加载示例',
    fit: '适应',
    webgl: 'WebGL 加速',
    wasm: 'WASM fallback',
    lineWeight: '线宽',
    language: '语言',
    fileAria: '打开本地 DWF 或 DWFx 文件',
    demoAria: '示例文件',
    fetchFailed: '示例文件加载失败',
    lineModes: {
      adaptive: 'CAD 总览细线',
      hairline: '细线',
      physical: '真实线宽'
    }
  }
};
let locale = DEFAULT_LOCALE;
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

function t(key) {
  return STRINGS[locale]?.[key] ?? STRINGS.en[key] ?? key;
}

function applyLocale() {
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }
  $('file').setAttribute('aria-label', t('fileAria'));
  $('demoSelect').setAttribute('aria-label', t('demoAria'));
  $('language').setAttribute('aria-label', t('language'));
  for (const option of $('lineMode').options) {
    option.textContent = STRINGS[locale].lineModes[option.value] ?? option.textContent;
  }
  updateHint();
}

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
  $('demoHint').textContent = (locale === 'zh' ? demo?.descriptionZh : demo?.description) ?? demo?.description ?? '';
}

async function loadDemo(demo = selectedDemo()) {
  if (!demo) return;
  const res = await fetch(`../examples/${demo.path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${t('fetchFailed')} ${demo.path}: HTTP ${res.status}`);
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
$('language').addEventListener('change', event => {
  locale = event.target.value === 'zh' ? 'zh' : 'en';
  applyLocale();
});

$('language').value = DEFAULT_LOCALE;
applyLocale();
await loadManifest();
await loadDemo(selectedDemo());
