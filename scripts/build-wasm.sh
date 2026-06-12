#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public

OUT="public/dwfv-render.wasm"
SRC="wasm/dwfv_render.c"
PREBUILT="wasm/dwfv-render.prebuilt.wasm"

# Override when integrating into a larger frontend build where the shipped
# prebuilt module is sufficient: SKIP_WASM_BUILD=1 npm run build
if [[ "${SKIP_WASM_BUILD:-0}" == "1" ]]; then
  if [[ -f "$PREBUILT" ]]; then
    cp "$PREBUILT" "$OUT"
    echo "SKIP_WASM_BUILD=1: copied prebuilt wasm to $OUT"
    exit 0
  fi
  echo "SKIP_WASM_BUILD=1 was set, but $PREBUILT is missing." >&2
  exit 1
fi

if ! command -v clang >/dev/null 2>&1; then
  if [[ -f "$PREBUILT" ]]; then
    cp "$PREBUILT" "$OUT"
    echo "clang not found: copied prebuilt wasm to $OUT"
    exit 0
  fi
  echo "clang not found and no prebuilt wasm exists at $PREBUILT" >&2
  exit 1
fi

compile_with_target() {
  local target="$1"
  clang --target="$target" \
    -O3 -nostdlib \
    -Wl,--no-entry \
    -Wl,--export-memory \
    -Wl,--export=dwfv_alloc \
    -Wl,--export=dwfv_reset_heap \
    -Wl,--export=dwfv_clear \
    -Wl,--export=dwfv_draw_polyline \
    -Wl,--export=dwfv_draw_polygon \
    -Wl,--export=dwfv_transform_points \
    -Wl,--allow-undefined \
    -o "$OUT" "$SRC"
}

# The correct LLVM targets are wasm32-unknown-unknown or wasm32.  The previous
# wasm32-unknown-unknown-wasm triple is not accepted by many Clang builds.
if compile_with_target "wasm32-unknown-unknown" >/dev/null 2>&1; then
  echo "Built $OUT with clang target wasm32-unknown-unknown"
  exit 0
fi

if compile_with_target "wasm32" >/dev/null 2>&1; then
  echo "Built $OUT with clang target wasm32"
  exit 0
fi

if [[ -f "$PREBUILT" ]]; then
  cp "$PREBUILT" "$OUT"
  echo "Copied prebuilt wasm to $OUT"
  exit 0
fi

echo "error: unable to build wasm and no prebuilt module is available." >&2
exit 1
