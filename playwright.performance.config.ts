import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.SEQUENT_PERFORMANCE_PORT ?? 14174);
const dataDirectory = mkdtempSync(join(tmpdir(), "sequent-performance-"));

export default defineConfig({
  testDir: "tests/performance",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node tests/performance/prepare-owner.ts && npm run build && npm run preview -- --host 127.0.0.1 --port ${port}`,
    port,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      SEQUENT_DATA_DIR: dataDirectory,
      SEQUENT_PERFORMANCE_DATA_DIR: dataDirectory,
      SEQUENT_SECURE_COOKIES: "false",
      SEQUENT_CODEX_ENABLED: "false",
      SEQUENT_DIZ_ENABLED: "false",
    },
  },
  projects: [{ name: "chromium-performance", use: { ...devices["Desktop Chrome"] } }],
});
