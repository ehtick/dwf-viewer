// Minimal CAD-oriented raster backend for the browser viewer.
// It intentionally avoids libc and dynamic dependencies so clang can emit a compact wasm32 module.

typedef unsigned int u32;
typedef unsigned char u8;

extern unsigned char __heap_base;
static u32 heap_ptr = 0;

static int abs_i(int v) { return v < 0 ? -v : v; }
static int clamp_i(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }
static float min_f(float a, float b) { return a < b ? a : b; }
static float max_f(float a, float b) { return a > b ? a : b; }

u32 dwfv_alloc(u32 size) {
  if (heap_ptr == 0) heap_ptr = (u32)&__heap_base;
  heap_ptr = (heap_ptr + 7u) & ~7u;
  u32 out = heap_ptr;
  heap_ptr += size;
  return out;
}

void dwfv_reset_heap(void) {
  heap_ptr = (u32)&__heap_base;
}

void dwfv_clear(u32 fb, int width, int height, u32 rgba) {
  u8* p = (u8*)fb;
  int total = width * height;
  u8 r = rgba & 255u;
  u8 g = (rgba >> 8) & 255u;
  u8 b = (rgba >> 16) & 255u;
  u8 a = (rgba >> 24) & 255u;
  for (int i = 0; i < total; i++) {
    p[i * 4 + 0] = r;
    p[i * 4 + 1] = g;
    p[i * 4 + 2] = b;
    p[i * 4 + 3] = a;
  }
}

static void blend_pixel(u8* fb, int width, int height, int x, int y, u32 rgba) {
  if ((unsigned)x >= (unsigned)width || (unsigned)y >= (unsigned)height) return;
  u8 sr = rgba & 255u;
  u8 sg = (rgba >> 8) & 255u;
  u8 sb = (rgba >> 16) & 255u;
  u8 sa = (rgba >> 24) & 255u;
  u8* d = fb + ((y * width + x) << 2);
  if (sa == 255u) {
    d[0] = sr; d[1] = sg; d[2] = sb; d[3] = 255u;
    return;
  }
  unsigned inv = 255u - sa;
  d[0] = (u8)((sr * sa + d[0] * inv) / 255u);
  d[1] = (u8)((sg * sa + d[1] * inv) / 255u);
  d[2] = (u8)((sb * sa + d[2] * inv) / 255u);
  d[3] = (u8)(sa + (d[3] * inv) / 255u);
}

static void draw_disc(u8* fb, int width, int height, int cx, int cy, int radius, u32 rgba) {
  if (radius <= 0) { blend_pixel(fb, width, height, cx, cy, rgba); return; }
  int r2 = radius * radius;
  for (int y = cy - radius; y <= cy + radius; y++) {
    for (int x = cx - radius; x <= cx + radius; x++) {
      int dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) blend_pixel(fb, width, height, x, y, rgba);
    }
  }
}

static void draw_segment(u8* fb, int width, int height, float x0f, float y0f, float x1f, float y1f, u32 rgba, float thickness) {
  int x0 = (int)(x0f + (x0f >= 0 ? 0.5f : -0.5f));
  int y0 = (int)(y0f + (y0f >= 0 ? 0.5f : -0.5f));
  int x1 = (int)(x1f + (x1f >= 0 ? 0.5f : -0.5f));
  int y1 = (int)(y1f + (y1f >= 0 ? 0.5f : -0.5f));
  int dx = abs_i(x1 - x0), sx = x0 < x1 ? 1 : -1;
  int dy = -abs_i(y1 - y0), sy = y0 < y1 ? 1 : -1;
  int err = dx + dy;
  int radius = (int)(thickness * 0.5f + 0.5f);
  if (radius < 0) radius = 0;
  for (;;) {
    draw_disc(fb, width, height, x0, y0, radius, rgba);
    if (x0 == x1 && y0 == y1) break;
    int e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

void dwfv_draw_polyline(u32 fb, int width, int height, u32 points, int count, u32 rgba, float thickness) {
  if (count < 2) return;
  float* p = (float*)points;
  u8* buffer = (u8*)fb;
  for (int i = 0; i < count - 1; i++) {
    draw_segment(buffer, width, height, p[i * 2], p[i * 2 + 1], p[i * 2 + 2], p[i * 2 + 3], rgba, thickness);
  }
}

void dwfv_draw_polygon(u32 fb, int width, int height, u32 points, int count, u32 rgba) {
  if (count < 3) return;
  float* p = (float*)points;
  u8* buffer = (u8*)fb;
  float miny = p[1], maxy = p[1];
  for (int i = 1; i < count; i++) {
    miny = min_f(miny, p[i * 2 + 1]);
    maxy = max_f(maxy, p[i * 2 + 1]);
  }
  int y0 = clamp_i((int)miny - 1, 0, height - 1);
  int y1 = clamp_i((int)maxy + 1, 0, height - 1);
  // Fixed-size intersection buffer. Large pathological polygons are clipped to keep the module simple and safe.
  float xs[4096];
  for (int y = y0; y <= y1; y++) {
    float scan = (float)y + 0.5f;
    int n = 0;
    for (int i = 0, j = count - 1; i < count; j = i++) {
      float xi = p[i * 2], yi = p[i * 2 + 1];
      float xj = p[j * 2], yj = p[j * 2 + 1];
      if (((yi <= scan && yj > scan) || (yj <= scan && yi > scan)) && n < 4096) {
        float x = xi + (scan - yi) * (xj - xi) / (yj - yi);
        xs[n++] = x;
      }
    }
    for (int i = 1; i < n; i++) {
      float v = xs[i];
      int k = i - 1;
      while (k >= 0 && xs[k] > v) { xs[k + 1] = xs[k]; k--; }
      xs[k + 1] = v;
    }
    for (int i = 0; i + 1 < n; i += 2) {
      int xa = clamp_i((int)(xs[i] + 0.5f), 0, width - 1);
      int xb = clamp_i((int)(xs[i + 1] + 0.5f), 0, width - 1);
      if (xb < xa) { int t = xa; xa = xb; xb = t; }
      for (int x = xa; x <= xb; x++) blend_pixel(buffer, width, height, x, y, rgba);
    }
  }
}

void dwfv_transform_points(u32 src, u32 dst, int count, float a, float b, float c, float d, float e, float f) {
  float* s = (float*)src;
  float* out = (float*)dst;
  for (int i = 0; i < count; i++) {
    float x = s[i * 2], y = s[i * 2 + 1];
    out[i * 2] = a * x + c * y + e;
    out[i * 2 + 1] = b * x + d * y + f;
  }
}
