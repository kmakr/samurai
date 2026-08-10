// Procedural washi paper and sumi-e ink textures.
//
// Everything here runs once, at load. The ink shapes are baked into an atlas so
// that at runtime a splat is just a quad with a UV rect — no per-frame canvas
// work, no texture re-uploads.

import * as THREE from 'three';

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// ---------------------------------------------------------------- washi paper

// Layered value noise. Cheap, and at these sizes it only runs once.
function valueNoise(rnd, size, cells) {
  const g = new Float32Array((cells + 1) * (cells + 1));
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const step = size / cells;
  return (x, y) => {
    const fx = x / step, fy = y / step;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const i0 = (iy % cells) * (cells + 1) + (ix % cells);
    const a = g[i0], b = g[i0 + 1];
    const c = g[i0 + cells + 1], d = g[i0 + cells + 2];
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  };
}

export function makePaperTexture(size = 1024, seed = 7) {
  const rnd = rng(seed);
  const c = canvas(size, size);
  const ctx = c.getContext('2d');

  const n1 = valueNoise(rnd, size, 8);
  const n2 = valueNoise(rnd, size, 32);
  const n3 = valueNoise(rnd, size, 128);

  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Broad mottling plus fine tooth. Kept high-key so ink reads black on it.
      const mottle = n1(x, y) * 0.22 + n2(x, y) * 0.34 + n3(x, y) * 0.44;
      let v = 236 + (mottle - 0.5) * 13;
      v += (rnd() - 0.5) * 5;
      const i = (y * size + x) * 4;
      d[i] = v; d[i + 1] = v - 1; d[i + 2] = v - 4; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Mulberry fibres: long pale strands with the occasional dark one.
  ctx.lineCap = 'round';
  for (let f = 0; f < 4200; f++) {
    const x = rnd() * size, y = rnd() * size;
    const ang = rnd() * Math.PI * 2;
    const len = 5 + rnd() * 26;
    const dark = rnd() < 0.22;
    ctx.strokeStyle = dark
      ? `rgba(120,112,96,${0.05 + rnd() * 0.09})`
      : `rgba(255,253,244,${0.10 + rnd() * 0.16})`;
    ctx.lineWidth = 0.5 + rnd() * 1.0;
    ctx.beginPath();
    ctx.moveTo(x, y);
    // A gentle bow so strands don't look machine-straight.
    const mx = x + Math.cos(ang) * len * 0.5 + (rnd() - 0.5) * 8;
    const my = y + Math.sin(ang) * len * 0.5 + (rnd() - 0.5) * 8;
    ctx.quadraticCurveTo(mx, my, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }

  // A few age spots — foxing.
  for (let i = 0; i < 40; i++) {
    const x = rnd() * size, y = rnd() * size, r = 3 + rnd() * 14;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(150,132,100,${0.03 + rnd() * 0.05})`);
    g.addColorStop(1, 'rgba(150,132,100,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// ------------------------------------------------------------- ink primitives

// A closed, irregular blob. Quadratic segments through lobe midpoints keep the
// outline organic rather than polygonal.
function blobPath(ctx, cx, cy, r, wobble, rnd, lobes = 11) {
  const pts = [];
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + (rnd() - 0.5) * 0.25;
    const rr = r * (1 - wobble + rnd() * wobble * 2);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const start = mid(pts[pts.length - 1], pts[0]);
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i];
    const m = mid(cur, pts[(i + 1) % pts.length]);
    ctx.quadraticCurveTo(cur[0], cur[1], m[0], m[1]);
  }
  ctx.closePath();
}

// Capillary tendril: ink wicking along a paper fibre. Drawn as a chain of
// shrinking dots so the taper stays soft at any zoom.
function tendril(ctx, x, y, ang, len, w, rnd) {
  const steps = Math.max(4, len / 2);
  let px = x, py = y, a = ang;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    a += (rnd() - 0.5) * 0.35;
    px += Math.cos(a) * (len / steps);
    py += Math.sin(a) * (len / steps);
    const r = w * (1 - t) * (1 - t);
    if (r < 0.25) break;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return [px, py];
}

// One splat cell, drawn white-on-transparent. Colour comes from the material;
// only the alpha channel matters here.
function drawSplat(ctx, cx, cy, R, rnd, opts = {}) {
  const {
    tendrils = 26,
    droplets = 30,
    lobes = 4,
    spread = 2.4,
    wobble = 0.34,
  } = opts;

  ctx.fillStyle = '#fff';

  // Core: a few overlapping blobs so the silhouette is never a circle.
  for (let i = 0; i < lobes; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * R * 0.45;
    blobPath(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * (0.5 + rnd() * 0.5), wobble, rnd);
    ctx.fill();
  }

  // Tendrils creeping outward from the core edge.
  for (let i = 0; i < tendrils; i++) {
    const a = rnd() * Math.PI * 2;
    const r0 = R * (0.6 + rnd() * 0.4);
    tendril(ctx, cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, a, R * (0.3 + rnd() * spread * 0.6), R * (0.10 + rnd() * 0.13), rnd);
  }

  // Thrown droplets, thinning out with distance.
  for (let i = 0; i < droplets; i++) {
    const a = rnd() * Math.PI * 2;
    const t = Math.pow(rnd(), 0.6);
    const d = R * (0.8 + t * spread);
    const r = R * 0.16 * (1 - t * 0.85) * (0.4 + rnd());
    if (r < 0.4) continue;
    ctx.globalAlpha = 0.5 + rnd() * 0.5;
    blobPath(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0.4, rnd, 6);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// A directional flick, as if ink were thrown off a blade.
function drawFlick(ctx, cx, cy, R, rnd) {
  ctx.fillStyle = '#fff';
  const dir = 0; // atlas cells are authored pointing +x; instances rotate.

  // Head of the stroke.
  blobPath(ctx, cx - R * 1.1, cy, R * 0.72, 0.3, rnd);
  ctx.fill();

  // Tapering body.
  const L = R * 3.0;
  for (let i = 0; i < 60; i++) {
    const t = i / 60;
    const x = cx - R * 1.1 + Math.cos(dir) * L * t;
    const y = cy + Math.sin(t * 6.0) * R * 0.16 * t;
    const r = R * 0.62 * Math.pow(1 - t, 1.5);
    if (r < 0.3) break;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Spray shed along the arc.
  for (let i = 0; i < 34; i++) {
    const t = Math.pow(rnd(), 0.5);
    const x = cx - R * 1.1 + L * t + (rnd() - 0.5) * R * 0.6;
    const y = cy + (rnd() - 0.5) * R * 1.5 * t;
    const r = R * 0.13 * (1 - t * 0.7) * (0.3 + rnd());
    if (r < 0.35) continue;
    ctx.globalAlpha = 0.45 + rnd() * 0.55;
    blobPath(ctx, x, y, r, 0.45, rnd, 6);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// A single fat drop with a small tail — used for airborne blood.
function drawDrop(ctx, cx, cy, R, rnd) {
  ctx.fillStyle = '#fff';
  blobPath(ctx, cx, cy, R * 0.85, 0.16, rnd, 9);
  ctx.fill();
  for (let i = 0; i < 3; i++) {
    const r = R * (0.2 + rnd() * 0.2);
    blobPath(ctx, cx + (rnd() - 0.5) * R * 2, cy + (rnd() - 0.5) * R * 2, r, 0.4, rnd, 6);
    ctx.fill();
  }
}

// ------------------------------------------------------------------ ink atlas

export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 4;

// Row layout, by index: 0-1 splats, 2 flicks, 3 drops.
export const SPLAT_CELLS = 8;   // cells 0..7
export const FLICK_CELLS = 4;   // cells 8..11
export const DROP_CELLS = 4;    // cells 12..15

export function makeInkAtlas(cell = 256, seed = 21) {
  const rnd = rng(seed);
  const w = cell * ATLAS_COLS, h = cell * ATLAS_ROWS;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');

  // Ink is drawn onto a scratch cell, blurred into a soak halo, then the sharp
  // copy is laid back on top. That two-pass order is what sells "absorbed".
  const tmp = canvas(cell, cell);
  const tctx = tmp.getContext('2d');

  const cellAt = (i) => [(i % ATLAS_COLS) * cell, Math.floor(i / ATLAS_COLS) * cell];

  for (let i = 0; i < ATLAS_COLS * ATLAS_ROWS; i++) {
    tctx.clearRect(0, 0, cell, cell);
    const cx = cell / 2, cy = cell / 2;

    if (i < SPLAT_CELLS) {
      const R = cell * (0.11 + rnd() * 0.05);
      drawSplat(tctx, cx, cy, R, rnd, {
        tendrils: 20 + Math.floor(rnd() * 18),
        droplets: 22 + Math.floor(rnd() * 24),
        spread: 1.9 + rnd() * 1.4,
      });
    } else if (i < SPLAT_CELLS + FLICK_CELLS) {
      drawFlick(tctx, cx + cell * 0.12, cy, cell * 0.115, rnd);
    } else {
      drawDrop(tctx, cx, cy, cell * 0.30, rnd);
    }

    const [ox, oy] = cellAt(i);

    // Soak: two blurred passes at low alpha widen the stain into the fibres.
    ctx.save();
    ctx.translate(ox, oy);
    if ('filter' in ctx) {
      ctx.globalAlpha = 0.30;
      ctx.filter = `blur(${cell * 0.030}px)`;
      ctx.drawImage(tmp, 0, 0);
      ctx.globalAlpha = 0.22;
      ctx.filter = `blur(${cell * 0.012}px)`;
      ctx.drawImage(tmp, 0, 0);
      ctx.filter = 'none';
    }
    ctx.globalAlpha = 1;
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

// UV rect for an atlas cell, inset slightly so mipmaps can't bleed neighbours in.
export function cellUV(index) {
  const col = index % ATLAS_COLS;
  const row = Math.floor(index / ATLAS_COLS);
  const pad = 0.0015;
  const u0 = col / ATLAS_COLS + pad;
  const u1 = (col + 1) / ATLAS_COLS - pad;
  // Canvas rows run top-down; texture V runs bottom-up.
  const v1 = 1 - (row / ATLAS_ROWS) - pad;
  const v0 = 1 - ((row + 1) / ATLAS_ROWS) + pad;
  return [u0, v0, u1, v1];
}

export const splatCell = (rnd) => Math.floor(rnd() * SPLAT_CELLS);
export const flickCell = (rnd) => SPLAT_CELLS + Math.floor(rnd() * FLICK_CELLS);
export const dropCell = (rnd) => SPLAT_CELLS + FLICK_CELLS + Math.floor(rnd() * DROP_CELLS);

// ------------------------------------------------------------- brush stroke

// The sword trail. A tapered stroke with dry-brush streaks running along it,
// mapped so U travels the length of the swing.
export function makeBrushTexture(w = 512, h = 128, seed = 5) {
  const rnd = rng(seed);
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  // Body: thick at the start of the cut, whipping to nothing at the tip.
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.5);
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    const y = h * 0.5 - (h * 0.46) * Math.pow(1 - t, 0.7) * (0.55 + 0.45 * Math.sin(t * 3.1));
    ctx.lineTo(t * w, y);
  }
  for (let i = 64; i >= 0; i--) {
    const t = i / 64;
    const y = h * 0.5 + (h * 0.46) * Math.pow(1 - t, 0.7) * (0.55 + 0.45 * Math.sin(t * 3.1));
    ctx.lineTo(t * w, y);
  }
  ctx.closePath();
  ctx.fill();

  // Dry brush: scrape transparent streaks through it (kasure).
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 60; i++) {
    const y = rnd() * h;
    const x0 = rnd() * w * 0.7;
    const len = w * (0.1 + rnd() * 0.5);
    ctx.strokeStyle = `rgba(0,0,0,${0.15 + rnd() * 0.55})`;
    ctx.lineWidth = 0.5 + rnd() * 2.5;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(Math.min(w, x0 + len), y + (rnd() - 0.5) * 6);
    ctx.stroke();
  }
  // Bite the tail off so the stroke ends dry.
  const g = ctx.createLinearGradient(w * 0.55, 0, w, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = g;
  ctx.fillRect(w * 0.55, 0, w * 0.45, h);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
