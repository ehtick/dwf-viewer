import { DwfViewer } from '../dist/index.js?v=0.6.4';

const $ = (id) => document.getElementById(id);
const DEFAULT_DEMO_ID = 'blocks-tables-2d';
const DEFAULT_LOCALE = 'en';
const STRINGS = {
  en: {
    tagline: "World's first open-source pure frontend DWF/DWFx preview component",
    loadSample: 'Load sample',
    openFile: 'Open file',
    settings: 'Settings',
    webgl: 'WebGL acceleration',
    wasm: 'WASM fallback',
    lineWeight: 'Line weight',
    language: 'Language',
    fileAria: 'Open local DWF or DWFx file',
    demoAria: 'Example file',
    fetchFailed: 'Failed to fetch',
    downloading: 'Downloading sample',
    reading: 'Reading local file',
    preparing: 'Preparing file',
    parsing: 'Parsing and rendering',
    ready: 'Ready',
    failed: 'Load failed',
    lineModes: {
      adaptive: 'CAD adaptive',
      hairline: 'Hairline',
      physical: 'Physical'
    }
  },
  zh: {
    tagline: '世界首个开源纯前端 DWF/DWFx 预览组件',
    loadSample: '加载示例',
    openFile: '打开文件',
    settings: '设置',
    webgl: 'WebGL 加速',
    wasm: 'WASM fallback',
    lineWeight: '线宽',
    language: '语言',
    fileAria: '打开本地 DWF 或 DWFx 文件',
    demoAria: '示例文件',
    fetchFailed: '示例文件加载失败',
    downloading: '正在下载示例',
    reading: '正在读取本地文件',
    preparing: '正在准备文件',
    parsing: '正在解析并渲染',
    ready: '已就绪',
    failed: '加载失败',
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
  updateLoadingLocale();
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
  await runLoad(async () => {
    const bytes = await fetchArrayBufferWithProgress(`../examples/${demo.path}`, demo.title, demo.path);
    setLoading('parsing', demo.title, undefined);
    await viewer.load(bytes, loadOptions({ fileName: demo.path, pageIndex: demo.pageIndex ?? 0 }));
    setLoading('ready', demo.title, 1);
  });
}

$('file').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  void runLoad(async () => {
    const bytes = await readFileWithProgress(file);
    setLoading('parsing', file.name, undefined);
    await viewer.load(bytes, loadOptions({ fileName: file.name }));
    setLoading('ready', file.name, 1);
  }).catch(err => console.error(err));
});
$('loadDemo').addEventListener('click', () => loadDemo().catch(err => console.error(err)));
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

function loadOptions(extra = {}) {
  return {
    preferWebgl: $('webgl').checked,
    preferWasm: $('wasm').checked,
    lineWeightMode: $('lineMode').value,
    ...extra
  };
}

async function runLoad(task) {
  setBusy(true);
  try {
    await task();
    await delay(480);
    clearLoading();
  } catch (err) {
    showLoadError(err);
    throw err;
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy) {
  $('viewerShell').setAttribute('aria-busy', String(isBusy));
  for (const id of ['demoSelect', 'loadDemo', 'webgl', 'wasm', 'lineMode', 'language']) {
    $(id).disabled = isBusy;
  }
  $('file').disabled = isBusy;
  $('fileButton').classList.toggle('is-disabled', isBusy);
  $('settings').open = isBusy ? false : $('settings').open;
}

async function fetchArrayBufferWithProgress(url, title, fileName) {
  setLoading('downloading', title, 0);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${t('fetchFailed')} ${fileName}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !res.body.getReader || total <= 0) {
    const buffer = await res.arrayBuffer();
    setLoading('preparing', title, 1);
    return buffer;
  }

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      setLoading('downloading', `${title} · ${formatBytes(received)} / ${formatBytes(total)}`, received / total);
    }
  }
  setLoading('preparing', title, 1);
  return concatChunks(chunks, received).buffer;
}

function readFileWithProgress(file) {
  setLoading('reading', file.name, 0);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = event => {
      const progress = event.lengthComputable && event.total > 0 ? event.loaded / event.total : undefined;
      const detail = progress === undefined ? file.name : `${file.name} · ${formatBytes(event.loaded)} / ${formatBytes(event.total)}`;
      setLoading('reading', detail, progress);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'));
    reader.onload = () => {
      setLoading('preparing', file.name, 1);
      resolve(reader.result);
    };
    reader.readAsArrayBuffer(file);
  });
}

function setLoading(stageKey, detail, progress) {
  const status = $('loadStatus');
  const overlay = $('loadOverlay');
  const card = $('loadCard');
  const title = t(stageKey);
  status.hidden = false;
  overlay.hidden = false;
  card.classList.remove('is-error');
  $('loadOverlayTitle').dataset.stage = stageKey;
  $('loadStatusText').textContent = detail ? `${title} · ${detail}` : title;
  $('loadOverlayTitle').textContent = title;
  $('loadOverlayDetail').textContent = detail ?? '';
  updateProgress($('loadProgressBar'), progress);
  updateProgress($('loadOverlayBar'), progress);
}

function updateLoadingLocale() {
  if (!$('loadStatus') || $('loadStatus').hidden) return;
  const title = $('loadOverlayTitle').dataset.stage;
  if (title) $('loadOverlayTitle').textContent = t(title);
}

function updateProgress(bar, progress) {
  const isNumber = typeof progress === 'number' && Number.isFinite(progress);
  bar.classList.toggle('is-indeterminate', !isNumber);
  bar.style.width = isNumber ? `${Math.max(0, Math.min(1, progress)) * 100}%` : '';
  const track = bar.parentElement;
  if (track) {
    if (isNumber) track.setAttribute('aria-valuenow', String(Math.round(Math.max(0, Math.min(1, progress)) * 100)));
    else track.removeAttribute('aria-valuenow');
  }
}

function clearLoading() {
  $('loadStatus').hidden = true;
  $('loadOverlay').hidden = true;
}

function showLoadError(err) {
  const message = String(err?.message ?? err);
  setLoading('failed', message, 1);
  $('loadCard').classList.add('is-error');
}

function concatChunks(chunks, total) {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
