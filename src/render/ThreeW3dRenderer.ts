import { actionableDiagnostics, type RenderStats } from '../format/types.js';
import type { W3dMeshData, W3dPageData } from '../format/document.js';
import type { GenericRenderOptions } from './PageRenderer.js';

interface GpuMesh {
  mesh: W3dMeshData;
  vao?: WebGLVertexArrayObject | null;
  pos: WebGLBuffer;
  normal: WebGLBuffer;
  index: WebGLBuffer;
  edgeIndex?: WebGLBuffer;
  indexType: number;
  edgeIndexType?: number;
  indexCount: number;
  edgeIndexCount?: number;
  bytes: number;
}

interface SceneCache {
  page: W3dPageData;
  meshes: GpuMesh[];
  bytes: number;
}

interface ProgramInfo {
  program: WebGLProgram;
  aPosition: number;
  aNormal: number;
  uMvp: WebGLUniformLocation;
  uModel: WebGLUniformLocation;
  uColor: WebGLUniformLocation;
  uLight0: WebGLUniformLocation;
  uLight1: WebGLUniformLocation;
  uAmbient: WebGLUniformLocation;
}

interface EdgeProgramInfo {
  program: WebGLProgram;
  aPosition: number;
  uMvp: WebGLUniformLocation;
  uColor: WebGLUniformLocation;
}

export interface W3dCameraOptions {
  yaw?: number;
  pitch?: number;
  zoom?: number;
  panX?: number;
  panY?: number;
}

export class ThreeW3dRenderer {
  private gl?: WebGLRenderingContext;
  private program?: ProgramInfo;
  private edgeProgram?: EdgeProgramInfo;
  private cache = new Map<W3dPageData, SceneCache>();
  private currentCanvas?: HTMLCanvasElement;

  async render(page: W3dPageData, overlayCanvas: HTMLCanvasElement, options: GenericRenderOptions = {}): Promise<RenderStats> {
    const canvas = options.webglCanvas ?? overlayCanvas;
    if (options.webglCanvas) options.webglCanvas.style.visibility = 'visible';
    clearOverlay(overlayCanvas);
    const gl = this.ensureContext(canvas);
    const program = this.ensureProgram(gl);
    const edgeProgram = this.ensureEdgeProgram(gl);
    const scene = this.ensureScene(gl, page);
    this.evictScenes(gl, options.maxCachedScenes ?? 2, options.maxGpuCacheBytes ?? 160 * 1024 * 1024);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.DEPTH_TEST);
    // DWF eModel sources may mix right/left handed shell orientation.
    // Keep CAD preview robust by rendering shells double-sided.
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0.97, 0.98, 1.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program.program);

    const camera = makeCamera(page, canvas, options as W3dCameraOptions);
    gl.uniformMatrix4fv(program.uMvp, false, camera.mvp);
    gl.uniformMatrix4fv(program.uModel, false, identity4());
    gl.uniform3f(program.uLight0, 0.35, 0.65, 0.68);
    gl.uniform3f(program.uLight1, -0.75, 0.4, -0.5);
    gl.uniform1f(program.uAmbient, 0.28);

    let drawCalls = 0;
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    for (const gm of scene.meshes) {
      const color = gm.mesh.color ?? [0.72, 0.74, 0.78];
      gl.uniform3f(program.uColor, color[0], color[1], color[2]);
      if (gm.vao && 'bindVertexArray' in gl) {
        (gl as WebGL2RenderingContext).bindVertexArray(gm.vao);
      } else {
        bindMesh(gl, program, gm);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gm.index);
      gl.drawElements(gl.TRIANGLES, gm.indexCount, gm.indexType, 0);
      drawCalls++;
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    if (isWebGL2(gl)) gl.bindVertexArray(null);

    gl.useProgram(edgeProgram.program);
    gl.uniformMatrix4fv(edgeProgram.uMvp, false, camera.mvp);
    gl.uniform3f(edgeProgram.uColor, 0.035, 0.04, 0.045);
    gl.enable(gl.DEPTH_TEST);
    for (const gm of scene.meshes) {
      if (!gm.edgeIndex || !gm.edgeIndexCount) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, gm.pos);
      gl.enableVertexAttribArray(edgeProgram.aPosition);
      gl.vertexAttribPointer(edgeProgram.aPosition, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gm.edgeIndex);
      gl.drawElements(gl.LINES, gm.edgeIndexCount, gm.edgeIndexType ?? gm.indexType, 0);
      drawCalls++;
    }
    return { backend: 'threejs-webgl', commands: drawCalls, warnings: actionableDiagnostics(page.diagnostics) };
  }

  dispose(): void {
    if (this.gl) {
      for (const scene of this.cache.values()) disposeScene(this.gl, scene);
    }
    this.cache.clear();
    this.program = undefined;
    this.edgeProgram = undefined;
  }

  private ensureContext(canvas: HTMLCanvasElement): WebGLRenderingContext {
    if (this.gl && this.currentCanvas === canvas) return this.gl;
    const gl = (canvas.getContext('webgl2', { antialias: true, alpha: false })
      ?? canvas.getContext('webgl', { antialias: true, alpha: false })) as WebGLRenderingContext | null;
    if (!gl) throw new Error('WebGL is not available for 3D W3D rendering.');
    if (this.gl && this.currentCanvas !== canvas) {
      for (const scene of this.cache.values()) disposeScene(this.gl, scene);
      this.cache.clear();
    }
    this.gl = gl;
    this.currentCanvas = canvas;
    this.program = undefined;
    this.edgeProgram = undefined;
    return gl;
  }

  private ensureProgram(gl: WebGLRenderingContext): ProgramInfo {
    if (this.program) return this.program;
    const vs = compileShader(gl, gl.VERTEX_SHADER, `
      attribute vec3 a_position;
      attribute vec3 a_normal;
      uniform mat4 u_mvp;
      uniform mat4 u_model;
      varying vec3 v_normal;
      void main() {
        v_normal = normalize((u_model * vec4(a_normal, 0.0)).xyz);
        gl_Position = u_mvp * vec4(a_position, 1.0);
      }
    `);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec3 v_normal;
      uniform vec3 u_color;
      uniform vec3 u_light0;
      uniform vec3 u_light1;
      uniform float u_ambient;
      void main() {
        vec3 n = normalize(v_normal);
        float d0 = max(dot(n, normalize(u_light0)), 0.0);
        float d1 = max(dot(n, normalize(u_light1)), 0.0) * 0.45;
        vec3 color = u_color * (u_ambient + d0 * 0.78 + d1);
        gl_FragColor = vec4(color, 1.0);
      }
    `);
    const program = linkProgram(gl, vs, fs);
    const info: ProgramInfo = {
      program,
      aPosition: gl.getAttribLocation(program, 'a_position'),
      aNormal: gl.getAttribLocation(program, 'a_normal'),
      uMvp: mustUniform(gl, program, 'u_mvp'),
      uModel: mustUniform(gl, program, 'u_model'),
      uColor: mustUniform(gl, program, 'u_color'),
      uLight0: mustUniform(gl, program, 'u_light0'),
      uLight1: mustUniform(gl, program, 'u_light1'),
      uAmbient: mustUniform(gl, program, 'u_ambient')
    };
    this.program = info;
    return info;
  }


  private ensureEdgeProgram(gl: WebGLRenderingContext): EdgeProgramInfo {
    if (this.edgeProgram) return this.edgeProgram;
    const vs = compileShader(gl, gl.VERTEX_SHADER, `
      attribute vec3 a_position;
      uniform mat4 u_mvp;
      void main() {
        gl_Position = u_mvp * vec4(a_position, 1.0);
      }
    `);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform vec3 u_color;
      void main() {
        gl_FragColor = vec4(u_color, 0.9);
      }
    `);
    const program = linkProgram(gl, vs, fs);
    this.edgeProgram = {
      program,
      aPosition: gl.getAttribLocation(program, 'a_position'),
      uMvp: mustUniform(gl, program, 'u_mvp'),
      uColor: mustUniform(gl, program, 'u_color')
    };
    return this.edgeProgram;
  }


  private evictScenes(gl: WebGLRenderingContext, maxScenes: number, maxBytes: number): void {
    let bytes = Array.from(this.cache.values()).reduce((sum, s) => sum + s.bytes, 0);
    while (this.cache.size > Math.max(1, maxScenes) || bytes > maxBytes) {
      const first = this.cache.entries().next().value as [W3dPageData, SceneCache] | undefined;
      if (!first) break;
      this.cache.delete(first[0]);
      disposeScene(gl, first[1]);
      bytes -= first[1].bytes;
    }
  }

  private ensureScene(gl: WebGLRenderingContext, page: W3dPageData): SceneCache {
    const cached = this.cache.get(page);
    if (cached) return cached;
    const meshes: GpuMesh[] = [];
    let bytes = 0;
    const program = this.ensureProgram(gl);
    const hasVao = typeof (gl as WebGL2RenderingContext).createVertexArray === 'function';
    for (const mesh of page.model.meshes) {
      const pos = createBuffer(gl, gl.ARRAY_BUFFER, mesh.positions);
      const normals = mesh.normals ?? new Float32Array(mesh.positions.length);
      const normal = createBuffer(gl, gl.ARRAY_BUFFER, normals);
      const index = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, mesh.indices);
      const edgeIndex = mesh.edgeIndices ? createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, mesh.edgeIndices) : undefined;
      const gm: GpuMesh = {
        mesh,
        pos,
        normal,
        index,
        edgeIndex,
        indexType: mesh.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        edgeIndexType: mesh.edgeIndices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        indexCount: mesh.indices.length,
        edgeIndexCount: mesh.edgeIndices?.length,
        bytes: mesh.positions.byteLength + normals.byteLength + mesh.indices.byteLength + (mesh.edgeIndices?.byteLength ?? 0)
      };
      if ((mesh.indices instanceof Uint32Array || mesh.edgeIndices instanceof Uint32Array) && !isWebGL2(gl)) {
        const ext = gl.getExtension('OES_element_index_uint');
        if (!ext) throw new Error('This WebGL implementation does not support 32-bit element indices.');
      }
      if (hasVao) {
        const gl2 = gl as WebGL2RenderingContext;
        const vao = gl2.createVertexArray();
        gl2.bindVertexArray(vao);
        bindMesh(gl, program, gm);
        gl2.bindVertexArray(null);
        gm.vao = vao;
      }
      meshes.push(gm);
      bytes += gm.bytes;
    }
    const scene = { page, meshes, bytes };
    this.cache.set(page, scene);
    return scene;
  }
}


function disposeScene(gl: WebGLRenderingContext, scene: SceneCache): void {
  for (const gm of scene.meshes) {
    gl.deleteBuffer(gm.pos);
    gl.deleteBuffer(gm.normal);
    gl.deleteBuffer(gm.index);
    if (gm.edgeIndex) gl.deleteBuffer(gm.edgeIndex);
    if (gm.vao && isWebGL2(gl)) (gl as WebGL2RenderingContext).deleteVertexArray(gm.vao);
  }
}

function createBuffer(gl: WebGLRenderingContext, target: number, data: BufferSource): WebGLBuffer {
  const buf = gl.createBuffer();
  if (!buf) throw new Error('Failed to create WebGL buffer.');
  gl.bindBuffer(target, buf);
  gl.bufferData(target, data, gl.STATIC_DRAW);
  return buf;
}

function bindMesh(gl: WebGLRenderingContext, program: ProgramInfo, gm: GpuMesh): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, gm.pos);
  gl.enableVertexAttribArray(program.aPosition);
  gl.vertexAttribPointer(program.aPosition, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, gm.normal);
  gl.enableVertexAttribArray(program.aNormal);
  gl.vertexAttribPointer(program.aNormal, 3, gl.FLOAT, false, 0, 0);
}

function clearOverlay(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create WebGL shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown shader error';
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function linkProgram(gl: WebGLRenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create WebGL program.');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown program link error';
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

function mustUniform(gl: WebGLRenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
  const loc = gl.getUniformLocation(program, name);
  if (!loc) throw new Error(`Missing shader uniform ${name}.`);
  return loc;
}

function makeCamera(page: W3dPageData, canvas: HTMLCanvasElement, options: W3dCameraOptions): { mvp: Float32Array } {
  const b = page.model.bounds;
  const aspect = Math.max(1e-6, canvas.width / Math.max(1, canvas.height));
  const yaw = options.yaw ?? -0.78;
  const pitch = clamp(options.pitch ?? 0.55, -1.45, 1.45);
  const zoom = Math.max(0.05, Math.min(100, options.zoom ?? 1));
  const radius = Math.max(1e-4, b.radius);
  const distance = radius * 2.55 / zoom;
  const cp = Math.cos(pitch);
  const dir: [number, number, number] = [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
  const baseCenter = b.center;
  const right: [number, number, number] = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const camUp: [number, number, number] = [
    right[1] * dir[2] - right[2] * dir[1],
    right[2] * dir[0] - right[0] * dir[2],
    right[0] * dir[1] - right[1] * dir[0]
  ];
  const panScale = (radius * 2.0) / Math.max(1, Math.min(canvas.width, canvas.height)) / Math.max(0.1, zoom);
  const px = (options.panX ?? 0) * panScale;
  const py = (options.panY ?? 0) * panScale;
  const center: [number, number, number] = [
    baseCenter[0] - right[0] * px + camUp[0] * py,
    baseCenter[1] - right[1] * px + camUp[1] * py,
    baseCenter[2] - right[2] * px + camUp[2] * py
  ];
  const eye: [number, number, number] = [center[0] + dir[0] * distance, center[1] + dir[1] * distance, center[2] + dir[2] * distance];
  const view = lookAt(eye, center, [0, 1, 0]);
  const proj = perspective(Math.PI / 4, aspect, Math.max(0.001, distance - radius * 2.2), distance + radius * 3.2);
  return { mvp: multiply4(proj, view) };
}

function identity4(): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0
  ]);
}

function lookAt(eye: [number, number, number], target: [number, number, number], up: [number, number, number]): Float32Array {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1
  ]);
}

function multiply4(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row]! * b[col * 4 + 0]! +
        a[1 * 4 + row]! * b[col * 4 + 1]! +
        a[2 * 4 + row]! * b[col * 4 + 2]! +
        a[3 * 4 + row]! * b[col * 4 + 3]!;
    }
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

function isWebGL2(gl: WebGLRenderingContext): gl is WebGL2RenderingContext {
  return typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
}
