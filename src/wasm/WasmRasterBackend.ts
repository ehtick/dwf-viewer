import { colorToRgba32, type Matrix2D, transformPoint } from '../render/style.js';

interface WasmExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  dwfv_alloc(size: number): number;
  dwfv_reset_heap(): void;
  dwfv_clear(fb: number, width: number, height: number, rgba: number): void;
  dwfv_draw_polyline(fb: number, width: number, height: number, points: number, count: number, rgba: number, thickness: number): void;
  dwfv_draw_polygon(fb: number, width: number, height: number, points: number, count: number, rgba: number): void;
  dwfv_transform_points(src: number, dst: number, count: number, a: number, b: number, c: number, d: number, e: number, f: number): void;
}

export interface WasmRasterOptions {
  wasmUrl?: string;
}

export class WasmRasterBackend {
  private readonly wasmUrl: string;
  private exports?: WasmExports;
  private fbPtr = 0;
  private fbBytes = 0;
  private width = 0;
  private height = 0;

  constructor(options: WasmRasterOptions = {}) {
    this.wasmUrl = options.wasmUrl ?? './public/dwfv-render.wasm';
  }

  async init(): Promise<void> {
    if (this.exports) return;
    const response = await fetch(this.wasmUrl);
    if (!response.ok) throw new Error(`Failed to load WASM raster backend: ${response.status} ${response.statusText}`);
    const bytes = await response.arrayBuffer();
    const instance = await WebAssembly.instantiate(bytes, {});
    this.exports = instance.instance.exports as WasmExports;
  }

  begin(width: number, height: number, backgroundCss = '#ffffff'): void {
    const e = this.requireExports();
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.fbBytes = this.width * this.height * 4;
    e.dwfv_reset_heap();
    this.fbPtr = e.dwfv_alloc(this.fbBytes);
    this.ensureMemory(this.fbPtr + this.fbBytes);
    e.dwfv_clear(this.fbPtr, this.width, this.height, colorToRgba32(backgroundCss, 0xffffffff));
  }

  drawPolyline(points: number[], matrix: Matrix2D, strokeCss: string | undefined, thickness = 1): void {
    const e = this.requireExports();
    if (points.length < 4 || !strokeCss) return;
    const count = Math.floor(points.length / 2);
    const ptr = this.allocF32(count * 2);
    const heap = new Float32Array(e.memory.buffer, ptr, count * 2);
    for (let i = 0; i < count; i++) {
      const [x, y] = transformPoint(matrix, points[i * 2]!, points[i * 2 + 1]!);
      heap[i * 2] = x;
      heap[i * 2 + 1] = y;
    }
    e.dwfv_draw_polyline(this.fbPtr, this.width, this.height, ptr, count, colorToRgba32(strokeCss, 0xff000000), Math.max(1, thickness));
  }

  drawPolygon(points: number[], matrix: Matrix2D, fillCss: string | undefined): void {
    const e = this.requireExports();
    if (points.length < 6 || !fillCss) return;
    const count = Math.floor(points.length / 2);
    const ptr = this.allocF32(count * 2);
    const heap = new Float32Array(e.memory.buffer, ptr, count * 2);
    for (let i = 0; i < count; i++) {
      const [x, y] = transformPoint(matrix, points[i * 2]!, points[i * 2 + 1]!);
      heap[i * 2] = x;
      heap[i * 2 + 1] = y;
    }
    e.dwfv_draw_polygon(this.fbPtr, this.width, this.height, ptr, count, colorToRgba32(fillCss, 0xff000000));
  }

  toImageData(): ImageData {
    const e = this.requireExports();
    const src = new Uint8ClampedArray(e.memory.buffer, this.fbPtr, this.fbBytes);
    // Clone out of wasm memory because future allocations can invalidate the buffer view.
    return new ImageData(new Uint8ClampedArray(src), this.width, this.height);
  }

  private allocF32(floatCount: number): number {
    const e = this.requireExports();
    const byteCount = floatCount * 4;
    const ptr = e.dwfv_alloc(byteCount);
    this.ensureMemory(ptr + byteCount);
    return ptr;
  }

  private ensureMemory(requiredBytes: number): void {
    const e = this.requireExports();
    const page = 65536;
    const current = e.memory.buffer.byteLength;
    if (requiredBytes > current) {
      e.memory.grow(Math.ceil((requiredBytes - current) / page));
    }
  }

  private requireExports(): WasmExports {
    if (!this.exports) throw new Error('WASM backend is not initialized. Call init() first.');
    return this.exports;
  }
}
