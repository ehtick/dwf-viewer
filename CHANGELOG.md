# Changelog

## 0.6.3 - 2026-06-12

- Updated public positioning to describe DWF Viewer as the world's first open-source pure frontend DWF/DWFx preview component.
- Made the demo UI English by default and added a Chinese language switch.
- Fixed strict browser XML parsing of legacy Autodesk eModel metadata that contains invalid `xmlns:schemaLocation` declarations.
- Added production regression coverage for strict browser `DOMParser` behavior while keeping the Autodesk Floor Plans A03 and Robot Arm validations.
- Merged the latest 0.6.3 code while preserving the local Cloudflare Pages deployment flow, AGPL/NOTICE packaging, and dual npm publish helper.

## 0.6.1

- Changed the public demo default sample to `Blocks and Tables · Binary W2D DWF` for a faster and clearer first load.
- Kept Autodesk Floor Plans as an optional XPS WebGL validation sample instead of loading the large DWFx file by default.
- Updated demo asset versioning to `dist-v0.6.1`.

## 0.6.0

- Added WebGL-accelerated XPS/DWFx 2D vector rendering through `WebGlXpsBackend`.
- Added XPS ODTTF embedded font deobfuscation/loading for CAD-like text appearance.
- Tuned demo defaults for dense CAD overview linework and lower DPR memory pressure.
- Added curated Autodesk floor-plan DWFx demo entry with default A03 sheet.
- Coalesced viewer render requests to avoid zoom/pan render pile-ups.
- Kept Cloudflare demo assets versioned under `dist-v0.6.0` to prevent stale browser module caches.

## 0.5.1

- Added CAD adaptive line-weight rendering for XPS FixedPage, W2D Canvas/WASM, and W2D WebGL paths.
- Added overview text LOD culling to avoid dense annotation blobs at fit-to-page while preserving text when zoomed in.
- Added embedded XPS TrueType font loading for Glyphs when browsers support the FontFace API.
- Added demo line-weight mode selector: CAD adaptive, hairline, physical.
- Versioned demo dist assets under `dist-v0.5.1` to prevent stale browser module caches.

## 0.5.0

- Prepared the repository for public npm release and Cloudflare Pages demo deployment.
- Published normalized packages as `dwf-viewer` and `@flyfish-dev/dwf-viewer`.
- Adopted `AGPL-3.0-only` with `NOTICE` for strict open-source distribution.
- Added curated, de-duplicated demo example manifest.
- Removed production-success info diagnostics from W3D/eModel pages so the Robot Arm demo renders with zero page diagnostics.
- Added static demo build pipeline, package validation scripts, CI, and publish helpers.
