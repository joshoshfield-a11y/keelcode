/** Starfield: distant star shell. Neutral placeholder space backdrop. */

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

/** ~1600 stars on a shell (radius 700–1500), subtle blue-white tint variance. */
export function createStarfield(): THREE.Group {
  const group = new THREE.Group();
  const rand = mulberry(0x5eed);
  const n = 1600;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 700 + rand() * 800;
    const th = rand() * Math.PI * 2;
    const ph = Math.acos(2 * rand() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph);
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    // neutral white-blue variance, no color glow accents
    const b = 0.55 + rand() * 0.45;
    col[i * 3] = b * (0.85 + rand() * 0.15);
    col[i * 3 + 1] = b * (0.88 + rand() * 0.12);
    col[i * 3 + 2] = b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({
    size: 1.8, sizeAttenuation: false, vertexColors: true,
    depthWrite: false,
  });
  group.add(new THREE.Points(g, m));
  return group;
}
