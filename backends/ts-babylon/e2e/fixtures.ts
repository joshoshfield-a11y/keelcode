/**
 * E2E fixtures for the KeelCode ts-babylon demo specs.
 *
 * Extends Playwright's test with a `page` that, when KEEL_E2E_URL is set to a
 * non-localhost URL, serves the production build straight from dist/ via
 * request interception. This exists for sandboxes where the browser cannot
 * reach localhost (Local Network Access blocks loopback); in normal
 * environments KEEL_E2E_URL is unset and the specs use the config's baseURL
 * plus the preview webServer untouched.
 */
import { test as base, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

export const test = base.extend({
  page: async ({ page }, use) => {
    const fileUrl = process.env.KEEL_E2E_URL;
    if (fileUrl) {
      const dist = path.join(process.cwd(), 'dist');
      const origin = new URL(fileUrl).origin;
      await page.route(`${origin}/**/*`, (route) => {
        const u = new URL(route.request().url());
        const rel = u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\/+/, '');
        const p = path.join(dist, rel);
        try {
          if (fs.existsSync(p) && fs.statSync(p).isFile()) {
            const ext = path.extname(p);
            void route.fulfill({
              contentType: MIME[ext] || 'application/octet-stream',
              body: fs.readFileSync(p) as unknown as string,
            });
            return;
          }
        } catch {
          /* fall through to abort */
        }
        void route.abort();
      });
    }
    await use(page);
  },
});

export { expect } from '@playwright/test';

/** Navigate to the app: file-server URL in sandbox mode, baseURL otherwise. */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto(process.env.KEEL_E2E_URL ?? '/');
}
