# DWF Viewer

Pure frontend DWF/DWFx CAD viewer for browsers. It parses DWF/DWFx packages locally and renders common 2D and 3D content without a server-side CAD conversion service.

## Links

| Entry | URL |
|---|---|
| Online demo | https://dwf-viewer-demo.pages.dev/ |
| Repository | https://github.com/flyfish-dev/dwf-viewer |
| npm | https://www.npmjs.com/package/dwf-viewer |
| scoped npm | https://www.npmjs.com/package/@flyfish-dev/dwf-viewer |

Current version: `0.6.1`

## Why

DWF and DWFx are still common in manufacturing, construction, field service, engineering archives, PLM, after-sales systems, and document management products. Many web systems can preview PDF, Office files, and images, but DWF often falls back to desktop viewers, server-side conversion, or static thumbnails.

DWF Viewer is built for the browser-native path: parse the package, decode the sheet/model data, and render it directly inside a web application. This keeps integration simple for private deployments and reduces conversion queues, temporary files, and infrastructure coupling.

## Supported Paths

| Format / content | Status |
|---|---|
| DWF 6+ ZIP container | Supported |
| DWFx / OPC package | Supported |
| XPS FixedPage 2D sheets | Supported common subset with WebGL vector acceleration and Canvas text/image overlay |
| Classic binary WHIP!/W2D 2D sheets | Supported for core geometry/text/images used by Autodesk samples |
| Textual W2D pages | Supported for smoke tests and simple sheets |
| W3D/HSF 3D eModel shell geometry | Supported: uncompressed, CS_TRIVIAL, and Edgebreaker shell meshes |
| Three.js adapter | Supported |
| Built-in WebGL 3D renderer | Supported through `DwfViewer` |
| WASM raster fallback | Supported for 2D vector rasterization |
| eModel metadata | Materials, textures, scene tree, saved views, PMI/animation data containers |

The demo intentionally does not silently replace a failed 3D parse with a thumbnail. If an eModel contains a `.w3d` stream, it must decode to a `w3d-model` page or show an explicit diagnostic.

## Install

```bash
npm install dwf-viewer three
# or
npm install @flyfish-dev/dwf-viewer three
```

`three` is an optional peer dependency. It is required only when you use `createThreeGroupFromW3d()` directly. The built-in `DwfViewer` uses its own WebGL 3D renderer.

## Basic Browser Usage

```ts
import 'dwf-viewer/styles.css';
import { DwfViewer } from 'dwf-viewer';

const viewer = new DwfViewer(document.getElementById('viewer')!, {
  wasmUrl: '/dwfv-render.wasm',
  preferWebgl: true,
  preferWasm: true,
  maxDevicePixelRatio: 1.5,
  maxCanvasPixels: 12_000_000,
  maxGpuCacheBytes: 192 * 1024 * 1024,
  maxCachedScenes: 4,
  lineWeightMode: 'adaptive',
  minStrokeCssPx: 0.42,
  maxOverviewStrokeCssPx: 0.9,
  minTextCssPx: 1.05,
  minFilledAreaCssPx: 0.04
});

await viewer.load(file);
```

Copy the WASM asset from the package into your public assets directory:

```bash
cp node_modules/dwf-viewer/public/dwfv-render.wasm public/dwfv-render.wasm
```

For the scoped package:

```bash
cp node_modules/@flyfish-dev/dwf-viewer/public/dwfv-render.wasm public/dwfv-render.wasm
```

## WebGL 2D Rendering

Version `0.6.x` adds WebGL-accelerated XPS/DWFx 2D vector rendering through `WebGlXpsBackend`, alongside the existing W2D WebGL path.

The built-in viewer uses WebGL for Classic W2D and DWFx/XPS vector geometry when `preferWebgl` is enabled. Geometry is uploaded to GPU buffers and cached by page and zoom bucket; pan operations update shader uniforms. Text, images, and XPS image brushes stay on the transparent Canvas overlay so browser font rendering and bitmap decoding remain reliable.

For dense architectural sheets, the demo defaults are tuned for CAD review: 1.5 maximum DPR, a 12M-pixel canvas cap, adaptive thin-line overview, and render coalescing during wheel/pointer interaction.

## CAD Line-Weight Rendering

The default 2D rendering mode is `lineWeightMode: 'adaptive'`. At fit-to-page, linework is normalized toward screen-space hairlines so dense drawings remain readable; as zoom increases, original DWF/XPS line weights return progressively.

Available modes:

| Mode | Behavior |
|---|---|
| `adaptive` | Default. Overview thin-line rendering with zoom-aware recovery of source line weights. |
| `hairline` | Force strokes to a visible CSS-pixel hairline. Useful for dense plans and review thumbnails. |
| `physical` | Preserve source stroke widths. Useful for print-fidelity comparisons; dense sheets can look heavy when zoomed out. |

Related options:

```ts
new DwfViewer(el, {
  lineWeightMode: 'adaptive',
  minStrokeCssPx: 0.42,
  maxOverviewStrokeCssPx: 0.9,
  minTextCssPx: 1.05,
  minFilledAreaCssPx: 0.04
});
```

XPS/DWFx `Glyphs` use embedded TrueType fonts when the browser allows `FontFace` loading. Very small text is skipped in adaptive overview mode and appears normally when zoomed in; this avoids unreadable annotation blocks in dense architectural sheets.

## Three.js Integration

```ts
import * as THREE from 'three';
import { openDwfDocument, createThreeGroupFromW3d } from 'dwf-viewer';

const doc = await openDwfDocument(await file.arrayBuffer(), { fileName: file.name });
const page = doc.pageData.find(p => p.kind === 'w3d-model');

if (page?.kind === 'w3d-model') {
  const group = createThreeGroupFromW3d(page, THREE, {
    showFeatureEdges: true,
    textureResolver(texture) {
      return undefined;
    }
  });
  scene.add(group);
}
```

## Local Development

```bash
npm install
npm run build
npm run validate:production
npm run demo:serve
```

Then open:

```text
http://127.0.0.1:8080/
```

## Example Set

The demo examples are listed in `examples/manifest.json` and are intentionally de-duplicated:

| Example | Purpose |
|---|---|
| `blocks-and-tables.dwf` | Default demo. Binary WHIP!/W2D ePlot sample with fast loading and a clear first impression |
| `autodesk-floor-plans.dwfx` | Multi-page architectural DWFx/XPS sample, using A03 First Floor Plan for WebGL XPS, embedded font, and thin-line overview validation |
| `robot-arm.dwfx` | 3D W3D/HSF eModel with shell meshes, scene tree, materials, textures, and saved views |
| `minimal-xps.dwfx` | Small DWFx/XPS FixedPage sample |
| `text-w2d.dwf` | Textual W2D smoke-test sample |

Run:

```bash
npm run check:examples
```

## NPM Publishing Checklist

```bash
npm run clean
npm run build
npm run validate:production
npm run check:package
npm run publish:all
```

The package is published as both `dwf-viewer` and `@flyfish-dev/dwf-viewer`.

## Cloudflare Pages Demo

The repository includes `wrangler.toml` with:

```toml
name = "dwf-viewer-demo"
pages_build_output_dir = "./demo-dist"
```

Recommended Cloudflare Pages Git settings:

```text
Build command: npm run build:demo
Build output directory: demo-dist
Root directory: /
```

Direct upload:

```bash
npm run deploy:pages
```

`build:demo` produces a static directory containing demo HTML/JS, a versioned `dist-v*` directory, `public/dwfv-render.wasm`, `styles`, and curated examples. Versioned dist assets prevent stale browser module caches after releases.

## Public API

Main exports:

```ts
openDwfDocument(input, options?)
DwfViewer
PageRenderer
WebGlW2dBackend
WebGlXpsBackend
ThreeW3dRenderer
createThreeGroupFromW3d(page, THREE, options?)
```

Types:

```ts
LoadedDwfDocument
PageData
XpsPageData
W3dPageData
W3dModelData
W3dMeshData
W2dTextPageData
Diagnostic
RenderStats
```

## Production Behavior

The production validation target is strict for the bundled samples:

```text
Robot Arm:
page kind: w3d-model
meshes >= 30
triangles >= 40,000
non-info diagnostics: 0

Autodesk Floor Plans:
page kind: xps-fixed-page
pages >= 18
non-info diagnostics: 0
```

Run:

```bash
npm run validate:production
```

## License

DWF Viewer is licensed under `AGPL-3.0-only`. See `LICENSE` and `NOTICE`.

Commercial use, private forks, and second-development integrations must comply with the license and preserve attribution. Contributions are welcome through Issues and Pull Requests.

## Known Boundaries

This is a pure frontend implementation and is not affiliated with Autodesk Design Review or HOOPS Exchange. The parser is intentionally fail-closed for unsupported historical HSF/W2D opcode semantics: it should show explicit diagnostics instead of silently drawing guessed geometry. Current production coverage includes the core 2D/3D rendering paths needed by the bundled samples and extension points for materials, textures, PMI, animation, and selection tree metadata.
