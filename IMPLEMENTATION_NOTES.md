# Implementation notes

DWF Viewer is the world's first open-source pure frontend DWF/DWFx preview component for the web. These notes document the browser-native parser and renderer paths behind that positioning: no server-side CAD conversion, English-first public documentation, and a demo UI that can switch to Chinese.

## Rendering paths

DWFx is OPC/XPS based, so the viewer parses ZIP + XML and renders `FixedPage` content directly to Canvas2D/WASM primitives.

Classic DWF uses package resources and WHIP!/W2D streams. This build now has a native TypeScript binary W2D parser for the official Autodesk “Blocks and Tables” sample. The parser materializes WHIP drawing state into a common `W2dPrimitive[]` stream, so the rendering layer is shared with textual W2D fixtures.

## Binary W2D subset implemented

`src/format/w2dBinary.ts` decodes the WHIP opcodes needed by the official sample:

- extended ASCII metadata, including W2D header, line weight, color, font, layer, viewport, end marker;
- binary color RGBA and indexed color;
- binary font option records;
- visibility/fill state;
- line weight;
- 16-bit and 32-bit relative lines;
- 16-bit and 32-bit relative point sets for polyline/polygon;
- polytriangle strips, emitted as triangle polygons;
- circle, partial circle/arc, ellipse;
- basic text and complex text, including binary text option skipping;
- layer index records.

Classic W2D coordinates are treated as Y-up. `src/render/viewport.ts` flips them into Canvas Y-down space. Text is then drawn as a Canvas overlay in screen space so glyphs remain upright.

## Manifest/descriptor handling

`src/format/dwf.ts` now groups pages by `manifest.xml` sections instead of exposing every `.w2d` resource as a separate page. It reads descriptor transforms and uses them to align Markup Private XML primitives with the main W2D graphics stream.

## WASM module role

The TypeScript layer parses package structure and builds draw primitives. The C/WASM layer owns low-level pixel operations for high-frequency vector primitives: clear, polyline strokes, polygon scanline fill, point transform. Browser-native Canvas2D remains responsible for text overlays and image decoding.

## Security posture

- No server upload is required.
- ZIP is parsed in memory from central directory; unsupported compression methods are rejected.
- XML is parsed with `DOMParser` and not injected into DOM.
- Images are decoded through browser image decoders using `Blob`/`ImageBitmap`.
- Unsupported binary objects are reported via diagnostics instead of being silently treated as successful rendering.

## Known limitations

- ZIP64, encrypted ZIP, multi-disk ZIP are rejected.
- Browser `DecompressionStream` is used by default for deflate; pass a custom `InflateProvider` if a target browser lacks `deflate-raw`.
- XPS gradients, tiling brushes, advanced font glyph indices, resource dictionaries, complex clipping and even-odd holes are partial.
- Binary WHIP!/W2D compressed nested blocks, image opcodes, hatch/pattern exact semantics, full text metrics and every historical opcode are not complete.
- 3D W3D/eModel shell rendering is included for common HSF `TKE_Shell` geometry, including edgebreaker connectivity and full-resolution vertex arrays. Advanced material, texture, animation, PMI, and every historical HOOPS attribute opcode are not fully reproduced.


## WebGL performance path

This build adds `src/render/WebGlW2dBackend.ts` for Classic W2D pages. The renderer compiles stable WHIP/W2D primitives into one interleaved WebGL vertex buffer per page and stores only GPU buffers in an LRU scene cache. Zoom and pan are passed as uniforms, so interaction avoids re-running the binary parser and avoids full-frame WASM `ImageData` upload. In the built-in viewer, geometry is shown directly on a bottom WebGL canvas and text is drawn on a transparent top Canvas2D overlay, avoiding per-frame WebGL-to-2D framebuffer copies. Text remains Canvas2D because browser text shaping and fonts are materially better than attempting ad-hoc glyph rendering in this small viewer.

Memory controls are intentionally explicit: `maxGpuCacheBytes`, `maxCachedScenes`, `maxDevicePixelRatio`, and `maxCanvasPixels`. These defaults avoid excessive canvas bitmaps and GPU buffers on Retina/4K displays while keeping the official 2-page Autodesk sample resident in the cache. If WebGL creation or buffer upload fails, W2D rendering falls back to WASM raster, then Canvas2D.


## 2026-06 zoom/build 修复

### WASM build

旧脚本使用 `--target=wasm32-unknown-unknown-wasm`，部分 Clang 发行版会报：

```text
No available targets are compatible with triple "wasm32-unknown-unknown-wasm"
```

现已改为标准 `wasm32-unknown-unknown`，并使用 `-Wl,--export-memory` 导出线性内存。脚本会按顺序尝试：

1. `wasm32-unknown-unknown`
2. `wasm32`
3. 复制 `wasm/dwfv-render.prebuilt.wasm`

因此普通 `npm run build` 不再因为本机 Clang target 差异失败。

### Cursor-anchored zoom

旧实现把 pan 当成唯一平移量：

```ts
pan = cursor - (cursor - pan) * zoomRatio
```

但实际矩阵包含 fit-to-page 中心项：

```text
screen = fitCenter(zoom) + pan + pageCoord * baseScale * zoom
```

`fitCenter(zoom)` 会随 zoom 改变，所以旧公式会产生漂移。新版流程为：

1. 用当前页面矩阵反算鼠标下的文档坐标。
2. 用新 zoom、零 pan 计算基础矩阵。
3. 令 `pan = cursor - projectedDocumentPoint`。

这样 W2D、DWFx/XPS 和图片页面都能围绕鼠标位置缩放。


## Build compatibility fix

The browser inflater still uses the runtime `globalThis.DecompressionStream` API when available, but the source does not reference the DOM lib global type names directly. This avoids build failures with older TypeScript DOM typings. `tsconfig.json` uses `moduleResolution: "node"` and ES2020 libraries so the project builds on TypeScript 4.5+ as well as TypeScript 5.x.


## DWFx DWF-manifest-first loading

`src/format/dwfx.ts` now treats DWFx as an OPC container that may carry a DWF document sequence, not just as an XPS FixedDocument package. The loader reads `DWFDocumentSequence.dwfseq`, follows `ManifestReference` / document relationships to `manifest.xml`, and builds pages from manifest sections before falling back to package-wide `.fdseq` / `.fpage` scanning.

For `com.autodesk.dwf.ePlot` sections, the `2d streaming graphics` resource is normalized by stripping `?dwfresource_*` before ZIP lookup, then exposed as an XPS FixedPage. This skips synthetic notice pages that are present in the ZIP but absent from the manifest sheet list.

For `com.autodesk.dwf.eModel` sections, the loader now parses the `3d streaming graphics` W3D resource first. The `w3d.ts` parser inflates internal HSF zlib streams, scans `TKE_Shell` records, decodes CS_NONE/CS_TRIVIAL shell data, decodes Edgebreaker connectivity for scheme 2 streams, reads following full-resolution vertex arrays, patches dummies/aliases, triangulates faces, and emits typed-array meshes. If geometry decoding fails, the loader falls back to readable `thumbnail` or `preview` images and records diagnostics.


## 3D W3D WebGL path

`src/render/ThreeW3dRenderer.ts` is a Three.js-style WebGL renderer for decoded W3D meshes. It uploads positions, normals, and indices once per page, stores GPU buffers, and then updates only camera matrices during orbit/pan/zoom. The built-in viewer uses left-drag rotation, Shift/right-drag panning, wheel dolly zoom, and GPU depth testing/culling. The Robot Arm eModel sample decodes to 37 GPU meshes, 32,979 vertices, and 49,552 triangles.


## v0.4.1 browser W3D inflate fix

The Robot Arm DWFx contains a zlib-wrapped W3D stream starting at byte 38, followed by a trailing NUL padding byte. Some browser `DecompressionStream('deflate')` implementations reject that padded zlib stream even though Node accepts it. The W3D parser now strips the zlib header/trailer and inflates the raw deflate body first, then falls back to trimmed/full zlib candidates.

Validation command:

```bash
npm run validate:production
```

Expected Robot Arm result: `pageKind = w3d-model`, `meshes = 37`, `triangles = 49552`, `nonInfoDiagnostics = 0`.
