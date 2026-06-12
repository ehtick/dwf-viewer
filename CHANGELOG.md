# Changelog

## 0.5.1

- Published as `dwf-viewer` and `@flyfish-dev/dwf-viewer` with AGPL-3.0-only package metadata.
- Added CAD adaptive line-weight rendering for XPS FixedPage, W2D Canvas/WASM, and W2D WebGL paths.
- Added overview text LOD culling to avoid black annotation blobs at fit-to-page while preserving text when zoomed in.
- Added embedded XPS TrueType font loading for Glyphs when browsers support the FontFace API.
- Added demo line-weight mode selector: CAD adaptive, hairline, physical.

## 0.5.0

- Prepared repository for public npm release and Cloudflare Pages demo deployment.
- Renamed the public package metadata to `dwf-viewer`.
- Added dual npm publishing support for `dwf-viewer` and `@flyfish-dev/dwf-viewer`.
- Switched the project license to `AGPL-3.0-only` and added `NOTICE`.
- Normalized GitHub repository metadata for `flyfish-dev/dwf-viewer`.
- Added curated, de-duplicated demo example manifest.
- Removed production-success info diagnostics from W3D/eModel pages so the Robot Arm demo renders with zero page diagnostics.
- Added static demo build pipeline and package validation scripts.
