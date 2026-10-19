import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:4174',
  },
  webServer: {
    command: 'npm run preview -- --port 4174 --strictPort',
    reuseExistingServer: true,
    url: 'http://localhost:4174',
  },
});
