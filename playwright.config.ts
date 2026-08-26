import { defineConfig, devices } from "@playwright/test";

const e2ePort = Number(process.env.SEQUENT_E2E_PORT ?? 14173);

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
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${e2ePort}`,
    port: e2ePort,
    // Un runtime preesistente potrebbe avere codice o dati diversi dall'HEAD sotto test.
    reuseExistingServer: false,
    env: {
      SEQUENT_DATA_DIR: process.env.SEQUENT_E2E_DATA_DIR ?? ".test-data/e2e",
      SEQUENT_SECURE_COOKIES: "false",
      SEQUENT_DESIGN_LAB: "test",
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
