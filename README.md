# DWF Viewer

Pure frontend DWF/DWFx viewer for browsers. It parses DWF/DWFx packages locally in the browser and renders common 2D and 3D content without a server-side CAD conversion service.

## Status

This repository is structured as a publishable npm package plus a static Cloudflare Pages demo. The same build is published under both `dwf-viewer` and `@flyfish-dev/dwf-viewer`.

Supported paths:

| Format / content | Status |
|---|---|
| DWF 6+ ZIP container | Supported |
| DWFx / OPC package | Supported |
| XPS FixedPage 2D sheets | Supported common subset |
| Classic binary WHIP!/W2D 2D sheets | Supported for core geometry/text/images used by Autodesk samples |
| W3D/HSF 3D eModel shell geometry | Supported: uncompressed, CS_TRIVIAL, and Edgebreaker shell meshes |
| Three.js adapter | Supported |
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

## Basic browser usage

```ts
import 'dwf-viewer/styles.css';
import { DwfViewer } from 'dwf-viewer';

const viewer = new DwfViewer(document.getElementById('viewer')!, {
  wasmUrl: '/dwfv-render.wasm',
  preferWebgl: true,
  preferWasm: true,
  maxDevicePixelRatio: 2,
  maxCanvasPixels: 16_777_216,
  maxGpuCacheBytes: 160 * 1024 * 1024,
  maxCachedScenes: 2
});

await viewer.load(file);
```

Copy the WASM asset from the package into your public assets directory:

```bash
cp node_modules/dwf-viewer/public/dwfv-render.wasm public/dwfv-render.wasm
```

## Three.js integration

```ts
import * as THREE from 'three';
import { openDwfDocument, createThreeGroupFromW3d } from 'dwf-viewer';

const doc = await openDwfDocument(await file.arrayBuffer(), { fileName: file.name });
const page = doc.pageData.find(p => p.kind === 'w3d-model');

if (page?.kind === 'w3d-model') {
  const group = createThreeGroupFromW3d(page, THREE, {
    showFeatureEdges: true,
    textureResolver(texture) {
      // Return a THREE.Texture if your app wants to bind DWFx texture resources.
      return undefined;
    }
  });
  scene.add(group);
}
```

## Local development

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

## Example set

The demo examples are listed in `examples/manifest.json` and are intentionally de-duplicated:

| Example | Purpose |
|---|---|
| `robot-arm.dwfx` | 3D W3D/HSF eModel with shell meshes, scene tree, materials, textures, saved views |
| `blocks-and-tables.dwf` | Binary WHIP!/W2D 2D ePlot sample |
| `minimal-xps.dwfx` | Small DWFx/XPS FixedPage sample |
| `text-w2d.dwf` | Textual W2D smoke-test sample |

Run:

```bash
npm run check:examples
```

## NPM publishing checklist

```bash
npm run clean
npm run publish:all
```

`publish:all` builds once, validates the production examples, checks the package tarball, then publishes both `dwf-viewer` and `@flyfish-dev/dwf-viewer`. Add npm options when needed:

```bash
npm run publish:all -- --dry-run
npm run publish:all -- --otp=123456
```

GitHub release publishing can use provenance through the included workflow and `NPM_TOKEN`.

## Cloudflare Pages demo

The repository includes `wrangler.toml` with:

```toml
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
npm run build:demo
npx wrangler pages deploy demo-dist
```

`build:demo` produces a static directory containing only demo HTML/JS, `dist`, `public/dwfv-render.wasm`, `styles`, and the curated examples.

## Public API

Main exports:

```ts
openDwfDocument(input, options?)
DwfViewer
PageRenderer
WebGlW2dBackend
ThreeW3dRenderer
createThreeGroupFromW3d(page, THREE, options?)
```

Types:

```ts
LoadedDwfDocument
PageData
W3dPageData
W3dModelData
W3dMeshData
W2dTextPageData
Diagnostic
RenderStats
```

## Production behavior

The production validation target is strict for the bundled Robot Arm eModel:

```text
page kind: w3d-model
meshes >= 30
triangles >= 40,000
page diagnostics: 0
non-info diagnostics: 0
```

Run:

```bash
npm run validate:production
```

## Known boundaries

This is a pure frontend implementation, not Autodesk Design Review or HOOPS Exchange. The parser is intentionally fail-closed for unsupported historical HSF/W2D opcode semantics: it should show explicit diagnostics instead of silently drawing incorrect geometry. Current production coverage includes the core 2D/3D rendering paths needed by the bundled samples and the extension points for materials, textures, PMI, animation and selection tree metadata.

## License

AGPL-3.0-only. See `LICENSE` and `NOTICE`.
