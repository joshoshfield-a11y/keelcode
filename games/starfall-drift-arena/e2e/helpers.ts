/**
 * E2E helpers for the KeelCode ts-three demo specs.
 *
 * - window.__keel typing (the demo's debug surface; see tests/api-contract.md)
 * - boot/wait helpers shared by the specs
 * - a dependency-free PNG decoder for the canvas non-blank pixel check
 *   (no @types/node in this repo, so this file uses only Uint8Array/DataView
 *   plus a tiny 'node:zlib' shim declared in ./node-shims.d.ts)
 */
import type { Page } from '@playwright/test';
import { inflateSync } from 'node:zlib';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * The demo declares the real window.__keel type in src/main.ts:
 * { world: World; loop: Loop; input: InputSys; playerId: number;
 *   renderer: THREE.WebGLRenderer }.
 * These helpers use that type directly (no redeclaration).
 */

/** Wait for the demo to boot and render a few frames. */
export async function waitForKeel(page: Page, timeout = 20000): Promise<void> {
  await page.waitForFunction(
    () => typeof (window as any).__keel !== 'undefined',
    undefined,
    { timeout },
  );
  // Let the renderer produce frames so pixel checks are meaningful.
  await page.waitForTimeout(1200);
}

/** Collect console errors and pageerrors; the caller asserts the list is empty. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

/** Read the player entity's Transform position via the debug surface. */
export async function playerPosition(page: Page): Promise<Vec3> {
  return page.evaluate(() => {
    const keel = window.__keel;
    const t = keel.world.get<{ x: number; y: number; z: number }>(keel.playerId, 'Transform');
    if (!t) throw new Error('player entity has no Transform');
    return { x: t.x, y: t.y, z: t.z };
  });
}

export interface PixelStats {
  width: number;
  height: number;
  mean: number;
  stddev: number;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decode an 8-bit non-interlaced RGB/RGBA PNG (what Playwright screenshots
 * produce) and return luminance mean/stddev over a pixel sample.
 */
export function pngStats(png: Uint8Array): PixelStats {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (png[i] !== sig[i]) throw new Error('not a PNG');
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatParts: Uint8Array[] = [];

  while (pos < png.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      bitDepth = png[pos + 16];
      colorType = png[pos + 17];
    } else if (type === 'IDAT') {
      idatParts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG: bitDepth=${bitDepth} colorType=${colorType}`);
  }
  const channels = colorType === 6 ? 4 : 3;

  let total = 0;
  for (const p of idatParts) total += p.length;
  const idat = new Uint8Array(total);
  let off = 0;
  for (const p of idatParts) {
    idat.set(p, off);
    off += p.length;
  }
  const raw = inflateSync(idat);

  const stride = width * channels;
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let rp = 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    for (let i = 0; i < stride; i++) {
      const f = raw[rp++];
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v: number;
      switch (filter) {
        case 0:
          v = f;
          break;
        case 1:
          v = f + a;
          break;
        case 2:
          v = f + b;
          break;
        case 3:
          v = f + ((a + b) >> 1);
          break;
        case 4:
          v = f + paeth(a, b, c);
          break;
        default:
          throw new Error(`bad PNG filter ${filter}`);
      }
      cur[i] = v & 0xff;
    }
    // Sample every 16th pixel: plenty for a blank-vs-rendered verdict.
    for (let x = 0; x < width; x += 16) {
      const o = x * channels;
      const lum = 0.2126 * cur[o] + 0.7152 * cur[o + 1] + 0.0722 * cur[o + 2];
      sum += lum;
      sumSq += lum * lum;
      n++;
    }
    prev.set(cur);
  }

  const mean = sum / n;
  return { width, height, mean, stddev: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) };
}
