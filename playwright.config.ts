import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const e2ePort = Number(process.env.SEQUENT_E2E_PORT ?? 14173);
const e2eDataDirectory =
  process.env.SEQUENT_E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), "sequent-e2e-"));
process.env.SEQUENT_E2E_DATA_DIR = e2eDataDirectory;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  // I progetti browser condividono intenzionalmente un solo runtime e database sintetico.
  // Eseguirli in parallelo renderebbe concorrenti setup, sessioni e logout della stessa app.
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${e2ePort}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node tests/e2e/prepare-owner.ts && npm run build && npm run preview -- --host 127.0.0.1 --port ${e2ePort}`,
    port: e2ePort,
    timeout: 120_000,
    // Un runtime preesistente potrebbe avere codice o dati diversi dall'HEAD sotto test.
    reuseExistingServer: false,
    env: {
      SEQUENT_DATA_DIR: e2eDataDirectory,
      SEQUENT_E2E_DATA_DIR: e2eDataDirectory,
      SEQUENT_SECURE_COOKIES: "false",
      SEQUENT_DESIGN_LAB: "test",
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "edge", use: { ...devices["Desktop Edge"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    {
      name: "mobile-safari",
      grep: /intestazione della pratica|rende una pratica selezionata disponibile offline|su mobile|design lab mobile|chiude la sessione/,
      use: { ...devices["iPhone 15"] },
    },
  ],
});
