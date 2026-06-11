export type PathCommand =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'A'; rx: number; ry: number; rotation: number; largeArc: boolean; sweep: boolean; x: number; y: number }
  | { type: 'Z' };

export interface FlattenedSubpath {
  points: number[];
  closed: boolean;
}

type Token = { kind: 'cmd'; value: string } | { kind: 'num'; value: number };

export function parsePathData(data: string): PathCommand[] {
  const tokens = tokenizePath(data);
  const commands: PathCommand[] = [];
  let i = 0;
  let cmd = '';
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let lastC: { x: number; y: number } | undefined;
  let lastQ: { x: number; y: number } | undefined;

  const hasNum = () => i < tokens.length && tokens[i]?.kind === 'num';
  const readNum = (): number => {
    const t = tokens[i++];
    if (!t || t.kind !== 'num') throw new Error(`Expected number in path data near token ${i}.`);
    return t.value;
  };
  const readFlag = (): boolean => readNum() !== 0;

  while (i < tokens.length) {
    const t = tokens[i];
    if (!t) break;
    if (t.kind === 'cmd') {
      cmd = t.value;
      i++;
      // XPS mini-language may start with F0/F1 fill-rule tokens. They are not drawing commands.
      if (cmd === 'F' || cmd === 'f') {
        if (hasNum()) readNum();
        continue;
      }
    } else if (!cmd) {
      i++;
      continue;
    }

    const rel = cmd === cmd.toLowerCase();
    const up = cmd.toUpperCase();
    const absX = (x: number) => rel ? cx + x : x;
    const absY = (y: number) => rel ? cy + y : y;

    if (up === 'M') {
      if (!hasNum()) continue;
      const x = absX(readNum());
      const y = absY(readNum());
      commands.push({ type: 'M', x, y });
      cx = sx = x; cy = sy = y; lastC = lastQ = undefined;
      while (hasNum()) {
        const lx = absX(readNum());
        const ly = absY(readNum());
        commands.push({ type: 'L', x: lx, y: ly });
        cx = lx; cy = ly;
      }
    } else if (up === 'L') {
      while (hasNum()) {
        const x = absX(readNum());
        const y = absY(readNum());
        commands.push({ type: 'L', x, y });
        cx = x; cy = y; lastC = lastQ = undefined;
      }
    } else if (up === 'H') {
      while (hasNum()) {
        const x = absX(readNum());
        commands.push({ type: 'L', x, y: cy });
        cx = x; lastC = lastQ = undefined;
      }
    } else if (up === 'V') {
      while (hasNum()) {
        const y = absY(readNum());
        commands.push({ type: 'L', x: cx, y });
        cy = y; lastC = lastQ = undefined;
      }
    } else if (up === 'C') {
      while (hasNum()) {
        const x1 = absX(readNum()), y1 = absY(readNum());
        const x2 = absX(readNum()), y2 = absY(readNum());
        const x = absX(readNum()), y = absY(readNum());
        commands.push({ type: 'C', x1, y1, x2, y2, x, y });
        cx = x; cy = y; lastC = { x: x2, y: y2 }; lastQ = undefined;
      }
    } else if (up === 'S') {
      while (hasNum()) {
        const reflected = lastC ? { x: 2 * cx - lastC.x, y: 2 * cy - lastC.y } : { x: cx, y: cy };
        const x2 = absX(readNum()), y2 = absY(readNum());
        const x = absX(readNum()), y = absY(readNum());
        commands.push({ type: 'C', x1: reflected.x, y1: reflected.y, x2, y2, x, y });
        cx = x; cy = y; lastC = { x: x2, y: y2 }; lastQ = undefined;
      }
    } else if (up === 'Q') {
      while (hasNum()) {
        const x1 = absX(readNum()), y1 = absY(readNum());
        const x = absX(readNum()), y = absY(readNum());
        commands.push({ type: 'Q', x1, y1, x, y });
        cx = x; cy = y; lastQ = { x: x1, y: y1 }; lastC = undefined;
      }
    } else if (up === 'T') {
      while (hasNum()) {
        const reflected = lastQ ? { x: 2 * cx - lastQ.x, y: 2 * cy - lastQ.y } : { x: cx, y: cy };
        const x = absX(readNum()), y = absY(readNum());
        commands.push({ type: 'Q', x1: reflected.x, y1: reflected.y, x, y });
        cx = x; cy = y; lastQ = reflected; lastC = undefined;
      }
    } else if (up === 'A') {
      while (hasNum()) {
        const rx = Math.abs(readNum()), ry = Math.abs(readNum());
        const rotation = readNum();
        const largeArc = readFlag();
        const sweep = readFlag();
        const x = absX(readNum()), y = absY(readNum());
        commands.push({ type: 'A', rx, ry, rotation, largeArc, sweep, x, y });
        cx = x; cy = y; lastC = lastQ = undefined;
      }
    } else if (up === 'Z') {
      commands.push({ type: 'Z' });
      cx = sx; cy = sy; lastC = lastQ = undefined;
    } else {
      // Unknown command: skip one token to keep the parser moving.
      i++;
    }
  }
  return commands;
}

export function applyPathToCanvas(ctx: CanvasRenderingContext2D, commands: PathCommand[]): void {
  let cx = 0, cy = 0, sx = 0, sy = 0;
  for (const c of commands) {
    switch (c.type) {
      case 'M': ctx.moveTo(c.x, c.y); cx = sx = c.x; cy = sy = c.y; break;
      case 'L': ctx.lineTo(c.x, c.y); cx = c.x; cy = c.y; break;
      case 'C': ctx.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y); cx = c.x; cy = c.y; break;
      case 'Q': ctx.quadraticCurveTo(c.x1, c.y1, c.x, c.y); cx = c.x; cy = c.y; break;
      case 'A': {
        const pts = arcToPoints(cx, cy, c.rx, c.ry, c.rotation, c.largeArc, c.sweep, c.x, c.y, 32);
        for (const [x, y] of pts) ctx.lineTo(x, y);
        cx = c.x; cy = c.y;
        break;
      }
      case 'Z': ctx.closePath(); cx = sx; cy = sy; break;
    }
  }
}

export function flattenPath(commands: PathCommand[], tolerance = 0.75): FlattenedSubpath[] {
  const paths: FlattenedSubpath[] = [];
  let current: FlattenedSubpath | undefined;
  let cx = 0, cy = 0, sx = 0, sy = 0;

  const ensure = () => {
    if (!current) {
      current = { points: [], closed: false };
      paths.push(current);
    }
    return current;
  };
  const push = (x: number, y: number) => {
    const p = ensure();
    const n = p.points.length;
    if (n >= 2 && Math.abs(p.points[n - 2]! - x) < 1e-9 && Math.abs(p.points[n - 1]! - y) < 1e-9) return;
    p.points.push(x, y);
  };

  for (const c of commands) {
    switch (c.type) {
      case 'M':
        current = { points: [c.x, c.y], closed: false };
        paths.push(current);
        cx = sx = c.x; cy = sy = c.y;
        break;
      case 'L':
        push(c.x, c.y);
        cx = c.x; cy = c.y;
        break;
      case 'C': {
        const steps = curveSteps(cx, cy, c.x, c.y, tolerance);
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const x = cubic(cx, c.x1, c.x2, c.x, t);
          const y = cubic(cy, c.y1, c.y2, c.y, t);
          push(x, y);
        }
        cx = c.x; cy = c.y;
        break;
      }
      case 'Q': {
        const steps = curveSteps(cx, cy, c.x, c.y, tolerance);
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const x = quad(cx, c.x1, c.x, t);
          const y = quad(cy, c.y1, c.y, t);
          push(x, y);
        }
        cx = c.x; cy = c.y;
        break;
      }
      case 'A': {
        const pts = arcToPoints(cx, cy, c.rx, c.ry, c.rotation, c.largeArc, c.sweep, c.x, c.y, Math.max(8, Math.ceil(24 / Math.max(tolerance, 0.1))));
        for (const [x, y] of pts) push(x, y);
        cx = c.x; cy = c.y;
        break;
      }
      case 'Z':
        if (current) {
          push(sx, sy);
          current.closed = true;
        }
        cx = sx; cy = sy;
        break;
    }
  }
  return paths.filter(p => p.points.length >= 2);
}

function tokenizePath(data: string): Token[] {
  const tokens: Token[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZzFf])|([-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(data)) !== null) {
    if (m[1]) tokens.push({ kind: 'cmd', value: m[1] });
    else if (m[2]) tokens.push({ kind: 'num', value: Number(m[2]) });
  }
  return tokens;
}

function curveSteps(x0: number, y0: number, x1: number, y1: number, tolerance: number): number {
  const d = Math.hypot(x1 - x0, y1 - y0);
  return Math.max(4, Math.min(96, Math.ceil(d / Math.max(1.5, tolerance * 6))));
}

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d;
}

function quad(a: number, b: number, c: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * a + 2 * mt * t * b + t * t * c;
}

// SVG/XPS endpoint-to-center arc conversion, sampled to points.
function arcToPoints(x1: number, y1: number, rx: number, ry: number, angleDeg: number, largeArc: boolean, sweep: boolean, x2: number, y2: number, maxSegments: number): [number, number][] {
  if (rx === 0 || ry === 0 || (Math.abs(x1 - x2) < 1e-9 && Math.abs(y1 - y2) < 1e-9)) return [[x2, y2]];
  const phi = angleDeg * Math.PI / 180;
  const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  let x1p = cosPhi * dx + sinPhi * dy;
  let y1p = -sinPhi * dx + cosPhi * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
  const rx2 = rx * rx, ry2 = ry * ry, x1p2 = x1p * x1p, y1p2 = y1p * y1p;
  let factor = (rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2) / (rx2 * y1p2 + ry2 * x1p2);
  factor = Math.max(0, factor);
  const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(factor);
  const cxp = coef * (rx * y1p / ry);
  const cyp = coef * (-ry * x1p / rx);
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;
  const v1x = (x1p - cxp) / rx, v1y = (y1p - cyp) / ry;
  const v2x = (-x1p - cxp) / rx, v2y = (-y1p - cyp) / ry;
  let theta1 = Math.atan2(v1y, v1x);
  let delta = Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const segs = Math.max(2, Math.min(maxSegments, Math.ceil(Math.abs(delta) / (Math.PI / 16))));
  const pts: [number, number][] = [];
  for (let i = 1; i <= segs; i++) {
    const t = theta1 + delta * i / segs;
    const x = cosPhi * rx * Math.cos(t) - sinPhi * ry * Math.sin(t) + cx;
    const y = sinPhi * rx * Math.cos(t) + cosPhi * ry * Math.sin(t) + cy;
    pts.push([x, y]);
  }
  return pts;
}
