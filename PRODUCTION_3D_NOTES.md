# Production 3D Notes

## Validation target

The bundled `examples/robot-arm.dwfx` is treated as the production 3D canary.

Expected result:

```text
page kind: w3d-model
meshes: 37
vertices: 32,979
triangles: 49,552
feature edges: 18,075
page diagnostics: 0
```

Run:

```bash
npm run build
npm run validate:production
```

## Fail-closed policy

For eModel sections that declare `.w3d` or `.hsf` geometry, the loader does not silently display a thumbnail if W3D parsing fails. It reports an explicit unsupported page with diagnostics. Thumbnail fallback is allowed only when no 3D stream is declared.

## Memory policy

The 3D renderer uploads each decoded mesh once into GPU buffers and keeps a bounded scene cache:

```ts
new DwfViewer(container, {
  maxGpuCacheBytes: 160 * 1024 * 1024,
  maxCachedScenes: 2,
  maxDevicePixelRatio: 2,
  maxCanvasPixels: 16_777_216
});
```

## Browser deployment

Serve the WASM file with `application/wasm`. The Cloudflare Pages demo writes `_headers` during `npm run build:demo` to set the MIME type and cache headers.

## Unsupported semantics

Unsupported historical HSF opcodes, advanced CAD display-list behavior, and full Design Review parity are tracked as incremental parser work. The rendering contract is: exact-enough supported semantics are displayed, unsupported semantics are diagnosed, and known-failing 3D geometry is not hidden by image fallback.
