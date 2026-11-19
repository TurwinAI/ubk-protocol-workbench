import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.E2E_PORT || 8799);

function detectLocalChromium(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  const cacheDir =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
      : path.join(os.homedir(), '.cache', 'ms-playwright');
  if (!fs.existsSync(cacheDir)) return undefined;
  try {
    const entries = fs.readdirSync(cacheDir).filter((e) => e.startsWith('chromium_headless_shell-')).sort().reverse();
    for (const entry of entries) {
      const candidates = [
        path.join(cacheDir, entry, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
        path.join(cacheDir, entry, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
        path.join(cacheDir, entry, 'chrome-linux', 'headless_shell'),
      ];
      const found = candidates.find((p) => fs.existsSync(p));
      if (found) return found;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

const executablePath = detectLocalChromium();

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: `PORT=${PORT} SERVE_STATIC=true PROTOTYPE_MODE=replay npx tsx src/server/index.ts`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
