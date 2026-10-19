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
    baseURL: 'http://localhost:4173',
  },
  webServer: {
    command: 'npm run preview',
    reuseExistingServer: true,
    url: 'http://localhost:4173',
  },
});
