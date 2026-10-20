/** Starfield: layered star shells + nebula dome + one distant gas giant.
 *
 * Neutral space backdrop (no voxel). All sky materials are fog:false and
 * depthWrite:false, and the dome/planet carry low renderOrders so they
 * always paint behind gameplay geometry.
 *
 * Headless-safe: canvas textures fall back to small DataTextures when
 * there is no DOM (node unit tests), so this module never touches
 * `document` unguarded.
 */

import * as THREE from 'three';

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Canvas helpers (headless-safe)
// ---------------------------------------------------------------------------

function makeCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function canvasTexture(canvas: HTMLCanvasElement | null, w: number, h: number, rgb: [number, number, number]): THREE.Texture {
  if (canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  // Headless fallback: flat 1x1 texture in roughly the right darkness.
  const data = new Uint8Array([rgb[0], rgb[1], rgb[2], 255]);
  const tex = new THREE.DataTexture(data, 1, 1);
  tex.needsUpdate = true;
  void w; void h;
  return tex;
}

// ---------------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------------

/** Star tint palette: mostly blue-white, then warm amber, teal, sparse dim red. */
const TINTS: Array<{ rgb: [number, number, number]; weight: number }> = [
  { rgb: [0.82, 0.88, 1.0], weight: 0.62 }, // blue-white
  { rgb: [1.0, 0.851, 0.627], weight: 0.20 }, // warm amber #ffd9a0
  { rgb: [0.624, 0.91, 1.0], weight: 0.13 }, // teal #9fe8ff
  { rgb: [1.0, 0.604, 0.541], weight: 0.05 }, // dim red #ff9a8a (sparse)
];

function pickTint(rand: () => number): [number, number, number] {
  const r = rand();
  let acc = 0;
  for (const t of TINTS) {
    acc += t.weight;
    if (r <= acc) return t.rgb;
  }
  return TINTS[0].rgb;
}

function starLayer(
  count: number,
  size: number,
  rMin: number,
  rMax: number,
  seed: number,
  brightness: number,
): THREE.Points {
  const rand = mulberry(seed);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = rMin + rand() * (rMax - rMin);
    const th = rand() * Math.PI * 2;
    const ph = Math.acos(2 * rand() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph);
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    const [tr, tg, tb] = pickTint(rand);
    // Red giants stay dim; everything else varies around the layer level.
    const isRed = tr === 1.0 && tb < 0.6;
    const b = brightness * (isRed ? 0.35 + rand() * 0.25 : 0.55 + rand() * 0.45);
    col[i * 3] = tr * b;
    col[i * 3 + 1] = tg * b;
    col[i * 3 + 2] = tb * b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({
    size, sizeAttenuation: false, vertexColors: true,
    depthWrite: false, fog: false,
  });
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;
  return points;
}

// ---------------------------------------------------------------------------
// Nebula dome
// ---------------------------------------------------------------------------

function nebulaTexture(): THREE.Texture {
  const S = 1024;
  const canvas = makeCanvas(S, S);
  if (canvas) {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Near-black deep-space base.
      ctx.fillStyle = '#04060d';
      ctx.fillRect(0, 0, S, S);
      const rand = mulberry(0x9eb1a);
      // Soft radial blobs: indigo / teal / ember, VERY subtle.
      const blobColors: Array<[number, number, number]> = [
        [62, 58, 140], // indigo
        [30, 110, 125], // teal
        [150, 72, 30], // ember
        [44, 48, 110], // deep indigo
      ];
      ctx.globalCompositeOperation = 'lighter';
      const blobs = 46;
      for (let i = 0; i < blobs; i++) {
        const [r, g, b] = blobColors[Math.floor(rand() * blobColors.length)];
        const x = rand() * S;
        const y = S * 0.15 + rand() * S * 0.7; // keep poles clean
        const radius = 90 + rand() * 260;
        const alpha = 0.03 + rand() * 0.055;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
        grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  return canvasTexture(canvas, S, S, [4, 6, 13]);
}

function createNebulaDome(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(3200, 48, 24);
  const mat = new THREE.MeshBasicMaterial({
    map: nebulaTexture(),
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.renderOrder = -10; // backdrop: paint first
  dome.frustumCulled = false;
  return dome;
}

// ---------------------------------------------------------------------------
// Distant planet (banded gas giant)
// ---------------------------------------------------------------------------

function planetTexture(): THREE.Texture {
  const W = 512;
  const H = 256;
  const canvas = makeCanvas(W, H);
  if (canvas) {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Horizontal bands: cream / rust / olive gas-giant palette.
      const stops: Array<[string, number]> = [
        ['#c9b98f', 0.00],
        ['#e8dcc0', 0.12],
        ['#b0663a', 0.24],
        ['#e3d3ae', 0.36],
        ['#8a8a5a', 0.48],
        ['#dccda6', 0.58],
        ['#a85f36', 0.70],
        ['#e8dcc0', 0.82],
        ['#9a8f5e', 0.92],
        ['#c9b98f', 1.00],
      ];
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      for (const [color, at] of stops) grad.addColorStop(at, color);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      // Wavy band edges: translucent stripes offset by a sine.
      const rand = mulberry(0x9a17);
      ctx.globalAlpha = 0.16;
      for (let i = 0; i < 26; i++) {
        const y0 = rand() * H;
        ctx.fillStyle = rand() > 0.5 ? '#f4ecd4' : '#7a4a28';
        ctx.beginPath();
        ctx.moveTo(0, y0);
        for (let x = 0; x <= W; x += 16) {
          ctx.lineTo(x, y0 + Math.sin((x / W) * Math.PI * 2 + i) * 3.5);
        }
        ctx.lineTo(W, y0 + 5 + rand() * 4);
        ctx.lineTo(0, y0 + 5 + rand() * 4);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // Storm spot.
      const spot = ctx.createRadialGradient(W * 0.68, H * 0.62, 2, W * 0.68, H * 0.62, 26);
      spot.addColorStop(0, 'rgba(196,92,52,0.85)');
      spot.addColorStop(0.7, 'rgba(176,80,44,0.45)');
      spot.addColorStop(1, 'rgba(176,80,44,0)');
      ctx.fillStyle = spot;
      ctx.beginPath();
      ctx.ellipse(W * 0.68, H * 0.62, 34, 17, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = canvasTexture(canvas, W, H, [216, 201, 163]);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function createPlanet(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(170, 48, 32);
  const mat = new THREE.MeshStandardMaterial({
    map: planetTexture(),
    roughness: 0.9,
    metalness: 0.0,
    emissive: new THREE.Color(0x241207),
    emissiveIntensity: 1.0,
  });
  mat.fog = false;
  mat.depthWrite = false;
  const planet = new THREE.Mesh(geo, mat);
  planet.position.set(-1900, 430, -2500);
  planet.rotation.z = 0.18; // slight axial tilt so the bands read angled
  planet.renderOrder = -9; // behind gameplay, in front of the dome
  planet.frustumCulled = false;
  return planet;
}

// ---------------------------------------------------------------------------
// Public entry point (same export name/signature as before)
// ---------------------------------------------------------------------------

export function createStarfield(): THREE.Group {
  const group = new THREE.Group();
  group.add(createNebulaDome());
  group.add(createPlanet());
  // Near stars are few but chunky; far stars dense and fine.
  group.add(starLayer(350, 2.6, 900, 1400, 0x5eed01, 1.0));
  group.add(starLayer(900, 1.9, 1400, 2100, 0x5eed02, 0.85));
  group.add(starLayer(1600, 1.3, 2100, 3000, 0x5eed03, 0.7));
  return group;
}
