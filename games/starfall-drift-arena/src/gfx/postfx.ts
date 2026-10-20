/** Post-processing: UnrealBloom on desktop, nothing on mobile.
 *
 * Integration contract for the caller (main.ts):
 * - When createPostFX() returns non-null, render via postfx.render()
 *   INSTEAD of renderer.render(scene, camera).
 * - On resize, call postfx.setSize(w, h) alongside renderer.setSize().
 * - The OutputPass applies tone mapping + sRGB output; the renderer's
 *   toneMapping must stay THREE.ACESFilmicToneMapping (OutputPass reads
 *   it) — do not add any other tone-mapping/color-space pass.
 *
 * Returns null on mobile (perf: an extra fullscreen bloom chain is the
 * first thing to cut on a phone GPU) and on ANY construction error, so
 * the caller can always fall back to a plain renderer.render().
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Quality tier — mirrors src/gfx/quality.ts when present. */
export type QualityTier = 'desktop' | 'mobile';

export interface PostFX {
  render(): void;
  setSize(w: number, h: number): void;
}

export function createPostFX(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  tier: QualityTier,
): PostFX | null {
  if (tier === 'mobile') return null;
  try {
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      // Half-res base: bloom is low-frequency, so this is visually
      // equivalent and ~4x cheaper on software renderers.
      new THREE.Vector2(640, 360),
      0.55, // strength
      0.55, // radius
      0.82, // threshold — only bright emissives/flashes bloom
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    return {
      render(): void {
        composer.render();
      },
      setSize(w: number, h: number): void {
        composer.setSize(w, h);
        bloom.setSize(w, h);
      },
    };
  } catch {
    return null;
  }
}
