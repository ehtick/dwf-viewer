import type { Diagnostic } from '../format/types.js';
import { diag } from '../format/types.js';
import type { XpsPageData } from '../format/document.js';
import { childElements, getAttr, localName, parseNumberList } from '../format/util.js';
import { flattenPath, parsePathData, type PathCommand } from './xpsPath.js';
import { colorToRgba32, multiplyMatrix, parseBrushColor, parseMatrix, transformPoint, type Matrix2D } from './style.js';
import { adaptiveStrokeUserWidth, canvasDpr, estimateMatrixScale, shouldDrawFilledBounds, type CadLineStyleOptions } from './cadLineStyle.js';
import { fitPageMatrix } from './viewport.js';

export interface WebGlXpsRenderOptions extends CadLineStyleOptions {
  zoom?: number;
  panX?: number;
  panY?: number;
  background?: string;
  maxGpuCacheBytes?: number;
  maxCachedScenes?: number;
  compositeToTarget?: boolean;
}

export interface WebGlXpsRenderResult {
  commands: number;
  warnings: Diagnostic[];
  gpuBytes: number;
  vertexCount: number;
  pathCount: number;
  cacheHit: boolean;
}

interface WebGlScene {
  key: string;
  buffer: WebGLBuffer;
  vertexCount: number;
  gpuBytes: number;
  pathCount: number;
  lastUsed: number;
}

interface ParsedVectorPath {
  commands: PathCommand[];
  matrix: Matrix2D;
  opacity: number;
  fill?: string;
  stroke?: string;
  thickness: number;
  lineStyle: LineStyle;
  fillRule: CanvasFillRule;
  bounds?: { minX: number; minY: number; maxX: number; maxY: number };
}

interface LineStyle {
  cap: CanvasLineCap;
  join: CanvasLineJoin;
  miterLimit: number;
  dash: number[];
  dashOffset: number;
}

const VERTEX_STRIDE = 12;
const DEFAULT_MAX_GPU_CACHE_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_CACHED_SCENES = 4;
const IDENTITY_MATRIX: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export class WebGlXpsBackend {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly aPos: number;
  private readonly aColor: number;
  private readonly uMatrix: WebGLUniformLocation;
  private readonly uViewport: WebGLUniformLocation;
  private readonly scenes = new Map<string, WebGlScene>();
  private gpuBytes = 0;
  private tick = 0;

  constructor(canvas?: HTMLCanvasElement) {
    this.canvas = canvas ?? document.createElement('canvas');
    const gl = this.canvas.getContext('webgl', {
      alpha: false,
      antialias: true,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
    if (!gl) throw new Error('WebGLRenderingContext is not available.');
    this.gl = gl;
    this.program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.aPos = gl.getAttribLocation(this.program, 'a_pos');
    this.aColor = gl.getAttribLocation(this.program, 'a_color');
    const matrix = gl.getUniformLocation(this.program, 'u_matrix');
    const viewport = gl.getUniformLocation(this.program, 'u_viewport');
    if (this.aPos < 0 || this.aColor < 0 || !matrix || !viewport) throw new Error('Failed to resolve WebGL shader locations.');
    this.uMatrix = matrix;
    this.uViewport = viewport;
  }

  render(page: XpsPageData, root: Element, targetCanvas: HTMLCanvasElement, options: WebGlXpsRenderOptions = {}): WebGlXpsRenderResult {
    const warnings: Diagnostic[] = [];
    if (targetCanvas.width <= 0 || targetCanvas.height <= 0) {
      return { commands: 0, warnings, gpuBytes: this.gpuBytes, vertexCount: 0, pathCount: 0, cacheHit: true };
    }

    this.resize(targetCanvas.width, targetCanvas.height);
    const pageMatrix = fitPageMatrix({
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      pageWidth: page.width,
      pageHeight: page.height,
      zoom: options.zoom,
      panX: options.panX,
      panY: options.panY
    });
    const runtime = { dpr: canvasDpr(targetCanvas), zoom: options.zoom ?? 1 };
    const key = sceneKey(page, pageMatrix, options);
    let scene = this.scenes.get(key);
    const cacheHit = !!scene;
    if (!scene) {
      const vectors = collectVectorPaths(root);
      scene = this.compileScene(page, key, vectors, pageMatrix, options, runtime);
      this.scenes.set(key, scene);
      this.gpuBytes += scene.gpuBytes;
      this.evictIfNeeded(options);
      scene = this.scenes.get(key) ?? scene;
    }
    scene.lastUsed = ++this.tick;

    const gl = this.gl;
    const bg = rgba01(options.background ?? '#ffffff');
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, scene.buffer);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, VERTEX_STRIDE, 0);
    gl.enableVertexAttribArray(this.aColor);
    gl.vertexAttribPointer(this.aColor, 4, gl.UNSIGNED_BYTE, true, VERTEX_STRIDE, 8);
    gl.uniform4f(this.uMatrix, pageMatrix.a, pageMatrix.b, pageMatrix.c, pageMatrix.d);
    gl.uniform4f(this.uViewport, pageMatrix.e, pageMatrix.f, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, scene.vertexCount);

    if (options.compositeToTarget ?? true) {
      const ctx = targetCanvas.getContext('2d');
      if (!ctx) throw new Error('CanvasRenderingContext2D is not available for WebGL compositing.');
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      ctx.drawImage(this.canvas, 0, 0);
      ctx.restore();
    }

    if (scene.vertexCount === 0) {
      warnings.push(diag('warning', 'WEBGL_XPS_EMPTY_SCENE', 'WebGL XPS scene contained no drawable vector geometry; Canvas/WASM fallback may be required.', page.sourcePath));
    }

    return {
      commands: scene.pathCount,
      warnings,
      gpuBytes: this.gpuBytes,
      vertexCount: scene.vertexCount,
      pathCount: scene.pathCount,
      cacheHit
    };
  }

  dispose(): void {
    for (const scene of this.scenes.values()) this.gl.deleteBuffer(scene.buffer);
    this.scenes.clear();
    this.gpuBytes = 0;
  }

  private resize(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  private compileScene(page: XpsPageData, key: string, vectors: ParsedVectorPath[], pageMatrix: Matrix2D, options: WebGlXpsRenderOptions, runtime: { dpr: number; zoom: number }): WebGlScene {
    const writer = new VertexWriter();
    let pathCount = 0;
    for (const vector of vectors) {
      pathCount++;
      appendVectorPath(writer, vector, pageMatrix, options, runtime);
    }
    const bufferBytes = writer.byteLength;
    const maxBytes = options.maxGpuCacheBytes ?? DEFAULT_MAX_GPU_CACHE_BYTES;
    if (bufferBytes > maxBytes) {
      throw new Error(`WebGL XPS scene buffer would require ${formatBytes(bufferBytes)}, exceeding maxGpuCacheBytes=${formatBytes(maxBytes)}.`);
    }

    const gl = this.gl;
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Failed to allocate WebGLBuffer.');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, writer.toArrayBuffer(), gl.STATIC_DRAW);
    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
      gl.deleteBuffer(buffer);
      throw new Error(`WebGL XPS buffer upload failed: 0x${err.toString(16)} for ${page.sourcePath}.`);
    }
    return { key, buffer, vertexCount: writer.vertexCount, gpuBytes: bufferBytes, pathCount, lastUsed: ++this.tick };
  }

  private evictIfNeeded(options: WebGlXpsRenderOptions): void {
    const maxBytes = options.maxGpuCacheBytes ?? DEFAULT_MAX_GPU_CACHE_BYTES;
    const maxScenes = options.maxCachedScenes ?? DEFAULT_MAX_CACHED_SCENES;
    while (this.scenes.size > Math.max(1, maxScenes) || this.gpuBytes > maxBytes) {
      let oldest: WebGlScene | undefined;
      for (const scene of this.scenes.values()) if (!oldest || scene.lastUsed < oldest.lastUsed) oldest = scene;
      if (!oldest) break;
      this.scenes.delete(oldest.key);
      this.gl.deleteBuffer(oldest.buffer);
      this.gpuBytes -= oldest.gpuBytes;
    }
  }
}

function collectVectorPaths(root: Element): ParsedVectorPath[] {
  const out: ParsedVectorPath[] = [];
  walk(root, IDENTITY_MATRIX, 1, out);
  return out;
}

function walk(el: Element, matrix: Matrix2D, opacity: number, out: ParsedVectorPath[]): void {
  const name = localName(el);
  const local = elementMatrix(el);
  const composed = multiplyMatrix(matrix, local);
  const ownOpacity = opacity * parseOpacity(getAttr(el, 'Opacity'));

  if (name === 'Path') {
    const commands = extractPathCommands(el);
    if (commands.length > 0) {
      const fill = extractBrush(el, 'Fill', ownOpacity);
      const stroke = extractBrush(el, 'Stroke', ownOpacity);
      const thickness = Number(getAttr(el, 'StrokeThickness') ?? 1);
      if (fill || (stroke && thickness > 0)) {
        out.push({
          commands,
          matrix: composed,
          opacity: ownOpacity,
          fill,
          stroke,
          thickness: Number.isFinite(thickness) ? thickness : 1,
          lineStyle: extractLineStyle(el),
          fillRule: fillRule(el),
          bounds: pathBounds(commands)
        });
      }
    }
  }

  for (const child of childElements(el)) {
    const childName = localName(child);
    if (childName.includes('.')) continue;
    walk(child, composed, ownOpacity, out);
  }
}

function appendVectorPath(writer: VertexWriter, vector: ParsedVectorPath, pageMatrix: Matrix2D, options: WebGlXpsRenderOptions, runtime: { dpr: number; zoom: number }): void {
  const fullMatrix = multiplyMatrix(pageMatrix, vector.matrix);
  const localScale = estimateMatrixScale(vector.matrix);
  const sourceWidth = Math.max(0.000001, vector.thickness || 1);
  const width = Math.max(0.01, adaptiveStrokeUserWidth(sourceWidth, fullMatrix, options, runtime) * localScale);
  const subs = flattenPath(vector.commands, 0.5);
  const fill = vector.fill ? rgbaBytes(vector.fill) : undefined;
  const stroke = vector.stroke ? rgbaBytes(vector.stroke) : undefined;
  if (fill && shouldDrawFilledBounds(vector.bounds, fullMatrix, options, runtime)) {
    for (const sub of subs) {
      if (sub.closed || sub.points.length >= 6) appendPolygonFan(writer, transformPointsArray(sub.points, vector.matrix), fill);
    }
  }
  if (stroke && vector.thickness > 0) {
    for (const sub of subs) {
      const pts = transformPointsArray(sub.points, vector.matrix);
      const drawPts = sub.closed ? closePoints(pts) : pts;
      if (vector.lineStyle.dash.length > 0) appendDashedPolyline(writer, drawPts, width, vector.lineStyle, stroke);
      else appendPolyline(writer, drawPts, width, stroke);
    }
  }
}

class VertexWriter {
  private buffer = new ArrayBuffer(64 * 1024);
  private view = new DataView(this.buffer);
  vertexCount = 0;
  get byteLength(): number { return this.vertexCount * VERTEX_STRIDE; }
  push(x: number, y: number, color: RgbaBytes): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const offset = this.byteLength;
    this.ensure(VERTEX_STRIDE);
    this.view.setFloat32(offset, x, true);
    this.view.setFloat32(offset + 4, y, true);
    this.view.setUint8(offset + 8, color.r);
    this.view.setUint8(offset + 9, color.g);
    this.view.setUint8(offset + 10, color.b);
    this.view.setUint8(offset + 11, color.a);
    this.vertexCount++;
  }
  toArrayBuffer(): ArrayBuffer { return this.buffer.slice(0, this.byteLength); }
  private ensure(extraBytes: number): void {
    const needed = this.byteLength + extraBytes;
    if (needed <= this.buffer.byteLength) return;
    let next = this.buffer.byteLength;
    while (next < needed) next *= 2;
    const newBuffer = new ArrayBuffer(next);
    new Uint8Array(newBuffer).set(new Uint8Array(this.buffer, 0, this.byteLength));
    this.buffer = newBuffer;
    this.view = new DataView(this.buffer);
  }
}

interface RgbaBytes { r: number; g: number; b: number; a: number }
interface Point { x: number; y: number }

function appendPolygonFan(writer: VertexWriter, pts: Point[], color: RgbaBytes): void {
  if (pts.length < 3) return;
  const p0 = pts[0]!;
  for (let i = 1; i + 1 < pts.length; i++) {
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    if (triangleAreaAbs(p0, p1, p2) < 1e-6) continue;
    writer.push(p0.x, p0.y, color);
    writer.push(p1.x, p1.y, color);
    writer.push(p2.x, p2.y, color);
  }
}

function appendPolyline(writer: VertexWriter, pts: Point[], width: number, color: RgbaBytes): void {
  if (pts.length < 2) return;
  const half = Math.max(0.05, width * 0.5);
  for (let i = 0; i + 1 < pts.length; i++) appendLineSegment(writer, pts[i]!, pts[i + 1]!, half, color);
}

function appendDashedPolyline(writer: VertexWriter, pts: Point[], width: number, style: LineStyle, color: RgbaBytes): void {
  if (pts.length < 2 || style.dash.length === 0) return;
  const pattern = style.dash.map(v => Math.max(0.01, v * width));
  const total = pattern.reduce((a, b) => a + b, 0);
  if (total <= 0.01) { appendPolyline(writer, pts, width, color); return; }
  let patternIndex = 0;
  let remaining = pattern[0]!;
  let draw = true;
  let offset = ((style.dashOffset * width) % total + total) % total;
  while (offset > remaining) {
    offset -= remaining;
    patternIndex = (patternIndex + 1) % pattern.length;
    remaining = pattern[patternIndex]!;
    draw = !draw;
  }
  remaining -= offset;

  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len <= 1e-9) continue;
    let consumed = 0;
    while (consumed < len - 1e-9) {
      const step = Math.min(remaining, len - consumed);
      if (draw && step > 1e-9) {
        const t0 = consumed / len;
        const t1 = (consumed + step) / len;
        appendLineSegment(writer, { x: a.x + dx * t0, y: a.y + dy * t0 }, { x: a.x + dx * t1, y: a.y + dy * t1 }, Math.max(0.05, width * 0.5), color);
      }
      consumed += step;
      remaining -= step;
      if (remaining <= 1e-9) {
        patternIndex = (patternIndex + 1) % pattern.length;
        remaining = pattern[patternIndex]!;
        draw = !draw;
      }
    }
  }
}

function appendLineSegment(writer: VertexWriter, p0: Point, p1: Point, half: number, color: RgbaBytes): void {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-9) return;
  const nx = -dy / len * half;
  const ny = dx / len * half;
  const ax = p0.x + nx, ay = p0.y + ny;
  const bx = p0.x - nx, by = p0.y - ny;
  const cx = p1.x - nx, cy = p1.y - ny;
  const dx2 = p1.x + nx, dy2 = p1.y + ny;
  writer.push(ax, ay, color);
  writer.push(bx, by, color);
  writer.push(cx, cy, color);
  writer.push(ax, ay, color);
  writer.push(cx, cy, color);
  writer.push(dx2, dy2, color);
}

function transformPointsArray(points: number[], m: Matrix2D): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const [x, y] = transformPoint(m, points[i] ?? 0, points[i + 1] ?? 0);
    out.push({ x, y });
  }
  return out;
}

function closePoints(pts: Point[]): Point[] {
  if (pts.length < 2) return pts;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (first.x === last.x && first.y === last.y) return pts;
  return [...pts, { x: first.x, y: first.y }];
}

function triangleAreaAbs(a: Point, b: Point, c: Point): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

function sceneKey(page: XpsPageData, pageMatrix: Matrix2D, options: WebGlXpsRenderOptions): string {
  const mode = options.lineWeightMode ?? 'adaptive';
  const scaleBucket = mode === 'physical' ? 'physical' : String(Math.round(Math.log2(Math.max(1e-12, estimateMatrixScale(pageMatrix))) * 8));
  return `${page.id}|${page.sourcePath}|${page.width}x${page.height}|lw:${mode}:${scaleBucket}`;
}

function elementMatrix(el: Element): Matrix2D {
  let m = parseMatrix(getAttr(el, 'RenderTransform') ?? getAttr(el, 'Transform'));
  for (const child of childElements(el)) {
    const name = localName(child);
    if (name.endsWith('.RenderTransform') || name.endsWith('.Transform')) {
      const matrixEl = childElements(child).find(c => localName(c) === 'MatrixTransform');
      if (matrixEl) m = multiplyMatrix(m, parseMatrix(getAttr(matrixEl, 'Matrix')));
    }
  }
  const left = Number(getAttr(el, 'Canvas.Left') ?? 0);
  const top = Number(getAttr(el, 'Canvas.Top') ?? 0);
  if (left || top) m = multiplyMatrix({ a: 1, b: 0, c: 0, d: 1, e: left, f: top }, m);
  return m;
}

function extractPathCommands(pathEl: Element): PathCommand[] {
  const data = getAttr(pathEl, 'Data');
  if (data) return parsePathData(data);
  for (const prop of childElements(pathEl)) {
    if (localName(prop) !== 'Path.Data') continue;
    for (const geom of childElements(prop)) {
      const figures = getAttr(geom, 'Figures');
      if (figures) return parsePathData(figures);
    }
  }
  return [];
}

function extractBrush(el: Element, prop: 'Fill' | 'Stroke', opacity: number): string | undefined {
  const direct = getAttr(el, prop);
  if (direct) return parseBrushColor(direct, opacity);
  const solid = findPropertyBrush(el, prop, 'SolidColorBrush');
  if (solid) return parseBrushColor(getAttr(solid, 'Color'), opacity * parseOpacity(getAttr(solid, 'Opacity')));
  return undefined;
}

function findPropertyBrush(el: Element, prop: string, brushLocalName: string): Element | undefined {
  const propName = `${localName(el)}.${prop}`;
  for (const child of childElements(el)) {
    if (localName(child) !== propName) continue;
    return childElements(child).find(c => localName(c) === brushLocalName);
  }
  return undefined;
}

function parseOpacity(value?: string): number {
  if (!value) return 1;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
}

function fillRule(el: Element): CanvasFillRule {
  const data = getAttr(el, 'Data') ?? '';
  return /F0/.test(data) ? 'nonzero' : 'evenodd';
}

function extractLineStyle(el: Element): LineStyle {
  const start = (getAttr(el, 'StrokeStartLineCap') ?? '').toLowerCase();
  const end = (getAttr(el, 'StrokeEndLineCap') ?? '').toLowerCase();
  const dashCap = (getAttr(el, 'StrokeDashCap') ?? '').toLowerCase();
  const cap: CanvasLineCap = start === 'round' || end === 'round' || dashCap === 'round'
    ? 'round'
    : start === 'square' || end === 'square' || dashCap === 'square'
      ? 'square'
      : 'butt';
  const joinAttr = (getAttr(el, 'StrokeLineJoin') ?? '').toLowerCase();
  const join: CanvasLineJoin = joinAttr === 'round' ? 'round' : joinAttr === 'bevel' ? 'bevel' : 'miter';
  const miter = Number(getAttr(el, 'StrokeMiterLimit') ?? 10);
  return {
    cap,
    join,
    miterLimit: Number.isFinite(miter) && miter > 0 ? miter : 10,
    dash: parseNumberList(getAttr(el, 'StrokeDashArray') ?? '').filter(v => Number.isFinite(v) && v > 0),
    dashOffset: Number(getAttr(el, 'StrokeDashOffset') ?? 0) || 0
  };
}

function pathBounds(commands: PathCommand[]): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const c of commands) {
    if (c.type === 'M' || c.type === 'L') add(c.x, c.y);
    else if (c.type === 'C') { add(c.x1, c.y1); add(c.x2, c.y2); add(c.x, c.y); }
    else if (c.type === 'Q') { add(c.x1, c.y1); add(c.x, c.y); }
    else if (c.type === 'A') { add(c.x - c.rx, c.y - c.ry); add(c.x + c.rx, c.y + c.ry); }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : undefined;
}

function rgbaBytes(css: string | undefined): RgbaBytes {
  const packed = colorToRgba32(css, 0xff000000);
  return { r: packed & 255, g: (packed >>> 8) & 255, b: (packed >>> 16) & 255, a: (packed >>> 24) & 255 };
}

function rgba01(css: string): [number, number, number, number] {
  const c = rgbaBytes(css);
  return [c.r / 255, c.g / 255, c.b / 255, c.a / 255];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function createProgram(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create WebGLProgram.');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown link error';
    gl.deleteProgram(program);
    throw new Error(`WebGL program link failed: ${log}`);
  }
  return program;
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create WebGLShader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(`WebGL shader compile failed: ${log}`);
  }
  return shader;
}

const VERTEX_SHADER = `
attribute vec2 a_pos;
attribute vec4 a_color;
uniform vec4 u_matrix;
uniform vec4 u_viewport;
varying vec4 v_color;
void main() {
  float x = u_matrix.x * a_pos.x + u_matrix.z * a_pos.y + u_viewport.x;
  float y = u_matrix.y * a_pos.x + u_matrix.w * a_pos.y + u_viewport.y;
  vec2 clip = vec2((x / u_viewport.z) * 2.0 - 1.0, 1.0 - (y / u_viewport.w) * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  v_color = a_color;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec4 v_color;
void main() {
  gl_FragColor = v_color;
}
`;
