import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, "../server");
const testDb = path.join(serverDir, "data", "playwright-e2e.sqlite");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Chrome"]
  },
  webServer: [
    {
      command: "npm run dev",
      cwd: serverDir,
      url: "http://127.0.0.1:4400/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        NODE_ENV: "test",
        PORT: "4400",
        DATABASE_PATH: testDb,
        CORS_ORIGIN: "http://127.0.0.1:4173",
        ADMIN_JWT_SECRET: "playwright-test-secret-at-least-32-characters",
        ADMIN_PASSWORD: "playwright-admin-password"
      }
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 4173",
      cwd: here,
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000
    }
  ]
});
