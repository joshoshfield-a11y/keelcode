/** Particle FX system: one pooled THREE.Points draw for all transient
 * particles (explosion bursts, mining sparks, thruster trails).
 *
 * Headless-safe: nothing here runs until initFX() is called with a real
 * scene. Unit tests never init FX, so gameplay code must always go
 * through getFX()?.<method>() — a null FX is a silent no-op.
 *
 * Rendering: a single BufferGeometry (capacity 2048) with per-particle
 * position / color / size / alpha attributes, a canvas radial-sprite
 * texture, AdditiveBlending, depthWrite off, fog off. Alpha is driven
 * by remaining life in update(); dead particles are parked at y=99999
 * with size 0 so they cost nothing.
 */

import * as THREE from 'three';

export interface BurstOpts {
  count: number;
  color: string | string[];
  speed: number;
  life: number;
  size: number;
  /** 0..1 — 1 = full sphere spray, smaller = tighter cone around +Y. */
  spread?: number;
}

export interface FXSystem {
  update(dt: number): void;
  burst(x: number, y: number, z: number, opts: BurstOpts): void;
  sparks(x: number, y: number, z: number, nx: number, ny: number, nz: number, count: number): void;
  trail(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: string, size: number): void;
}

const CAPACITY = 2048;
const PARK_Y = 99999;

/** Soft radial sprite (white core -> transparent edge) drawn once.
 * Headless-safe: without a DOM, falls back to a 1x1 white DataTexture. */
function makeRadialTexture(): THREE.Texture {
  if (typeof document === 'undefined') {
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    tex.needsUpdate = true;
    return tex;
  }
  const s = 64;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // sizeAttenuation: point size scales with 1/distance
    gl_PointSize = aSize * (240.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
    if (a <= 0.001) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

class PooledFX implements FXSystem {
  readonly points: THREE.Points;

  // particle state (Structure-of-Arrays, ring-buffer allocation)
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly life: Float32Array;    // remaining seconds
  private readonly maxLife: Float32Array;
  private readonly drag: Float32Array;
  private cursor = 0;

  // geometry attributes (views over pos/col + dedicated arrays)
  private readonly attrSize: Float32Array;
  private readonly attrAlpha: Float32Array;
  private readonly geo: THREE.BufferGeometry;

  private readonly tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(CAPACITY * 3);
    this.vel = new Float32Array(CAPACITY * 3);
    this.col = new Float32Array(CAPACITY * 3);
    this.baseSize = new Float32Array(CAPACITY);
    this.life = new Float32Array(CAPACITY);
    this.maxLife = new Float32Array(CAPACITY);
    this.drag = new Float32Array(CAPACITY);
    this.attrSize = new Float32Array(CAPACITY);
    this.attrAlpha = new Float32Array(CAPACITY);
    for (let i = 0; i < CAPACITY; i++) this.pos[i * 3 + 1] = PARK_Y;

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.attrSize, 1));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.attrAlpha, 1));
    // Particles move freely; never let three cull the whole cloud.
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: makeRadialTexture() } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });

    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  /** Allocate one particle slot (ring buffer — overwrites the oldest). */
  private emit(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    r: number, g: number, b: number,
    life: number, size: number, drag: number,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % CAPACITY;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.baseSize[i] = size;
    this.drag[i] = drag;
    this.attrAlpha[i] = 1;
    this.attrSize[i] = size;
  }

  private pickColor(color: string | string[]): THREE.Color {
    if (Array.isArray(color)) {
      return this.tmpColor.set(color[(Math.random() * color.length) | 0]!);
    }
    return this.tmpColor.set(color);
  }

  burst(x: number, y: number, z: number, opts: BurstOpts): void {
    const spread = opts.spread ?? 1;
    for (let n = 0; n < opts.count; n++) {
      // random unit direction; spread<1 biases the cone toward +Y
      let dx = Math.random() * 2 - 1;
      let dy = Math.random() * 2 - 1;
      let dz = Math.random() * 2 - 1;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len; dy /= len; dz /= len;
      dy = dy * spread + (1 - spread);
      const dl = Math.hypot(dx, dy, dz) || 1;
      const sp = opts.speed * (0.25 + Math.random() * 0.75);
      const c = this.pickColor(opts.color);
      this.emit(
        x, y, z,
        (dx / dl) * sp, (dy / dl) * sp, (dz / dl) * sp,
        c.r, c.g, c.b,
        opts.life * (0.5 + Math.random() * 0.5),
        opts.size * (0.6 + Math.random() * 0.7),
        1.6,
      );
    }
  }

  sparks(x: number, y: number, z: number, nx: number, ny: number, nz: number, count: number): void {
    const nl = Math.hypot(nx, ny, nz) || 1;
    const ux = nx / nl, uy = ny / nl, uz = nz / nl;
    for (let n = 0; n < count; n++) {
      // spray in a cone around the normal, with a tangential jitter
      const j = 0.9;
      let dx = ux + (Math.random() * 2 - 1) * j;
      let dy = uy + (Math.random() * 2 - 1) * j;
      let dz = uz + (Math.random() * 2 - 1) * j;
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      const sp = 9 + Math.random() * 13;
      // bright white-hot core cooling to orange
      const c = this.tmpColor.set(Math.random() < 0.4 ? '#ffffff' : '#ffc36b');
      this.emit(
        x, y, z,
        dx * sp, dy * sp, dz * sp,
        c.r, c.g, c.b,
        0.22 + Math.random() * 0.3,
        0.9 + Math.random() * 0.7,
        2.2,
      );
    }
  }

  trail(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    color: string, size: number,
  ): void {
    const c = this.tmpColor.set(color);
    const n = 1 + ((Math.random() * 2) | 0); // 1-2 particles per call
    for (let i = 0; i < n; i++) {
      this.emit(
        x + (Math.random() - 0.5) * 0.5,
        y + (Math.random() - 0.5) * 0.5,
        z + (Math.random() - 0.5) * 0.5,
        vx * 0.15 + (Math.random() - 0.5) * 1.5,
        vy * 0.15 + (Math.random() - 0.5) * 1.5,
        vz * 0.15 + (Math.random() - 0.5) * 1.5,
        c.r, c.g, c.b,
        0.45 + Math.random() * 0.3,
        size * (0.7 + Math.random() * 0.6),
        1.2,
      );
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const { pos, vel, life, maxLife, drag, baseSize, attrAlpha, attrSize } = this;
    for (let i = 0; i < CAPACITY; i++) {
      if (life[i]! <= 0) continue;
      life[i] = life[i]! - dt;
      const i3 = i * 3;
      if (life[i]! <= 0) {
        pos[i3 + 1] = PARK_Y;
        attrAlpha[i] = 0;
        attrSize[i] = 0;
        continue;
      }
      const d = Math.max(0, 1 - drag[i]! * dt);
      vel[i3] = vel[i3]! * d;
      vel[i3 + 1] = vel[i3 + 1]! * d;
      vel[i3 + 2] = vel[i3 + 2]! * d;
      pos[i3] = pos[i3]! + vel[i3]! * dt;
      pos[i3 + 1] = pos[i3 + 1]! + vel[i3 + 1]! * dt;
      pos[i3 + 2] = pos[i3 + 2]! + vel[i3 + 2]! * dt;
      const frac = life[i]! / maxLife[i]!;
      attrAlpha[i] = frac;                       // fade out with life
      attrSize[i] = baseSize[i]! * (0.35 + 0.65 * frac); // and shrink
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  }
}

let instance: FXSystem | null = null;

/** Create the FX system in `scene` (idempotent — re-init returns the live one). */
export function initFX(scene: THREE.Scene): FXSystem {
  if (instance) return instance;
  instance = new PooledFX(scene);
  return instance;
}

/** The live FX system, or null when never inited (tests / headless). */
export function getFX(): FXSystem | null {
  return instance;
}
