/** Baked texture loader: manifest id -> public asset URL.
 *
 * The asset baker wrote 4 textures (asset-manifest.json); they are served
 * from `public/assets/`, so the runtime URL is `/assets/...`.
 * All ship/rock materials use these.
 */

import * as THREE from 'three';

const URLS: Record<string, string> = {
  'rocks/field/rock': '/assets/rocks/field/rock.png',
  'ships/pirate/hull': '/assets/ships/pirate/hull.png',
  'ships/player/hull': '/assets/ships/player/hull.png',
  'station/dock/hull': '/assets/station/dock/hull.png',
};

const cache = new Map<string, THREE.Texture>();

/** Resolve a manifest texture id to its served URL. */
export function textureUrl(id: string): string {
  const url = URLS[id];
  if (!url) throw new Error(`[textures] unknown baked texture id: ${id}`);
  return url;
}

/** Load (cached) a baked texture by manifest id.
 * Headless-safe: outside a DOM (unit tests) returns a 1x1 neutral stub
 * texture instead of touching TextureLoader/ImageLoader. */
export function loadBakedTexture(id: string): THREE.Texture {
  const hit = cache.get(id);
  if (hit) return hit;
  let tex: THREE.Texture;
  if (typeof document === 'undefined') {
    const data = new Uint8Array([200, 204, 212, 255]); // neutral gray
    tex = new THREE.DataTexture(data, 1, 1);
    tex.needsUpdate = true;
  } else {
    tex = new THREE.TextureLoader().load(textureUrl(id));
  }
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  cache.set(id, tex);
  return tex;
}
