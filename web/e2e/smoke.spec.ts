import { test, expect } from "@playwright/test";

test("@smoke production-like app and API health endpoints respond", async ({ page, request }) => {
  const apiBase = "http://127.0.0.1:4400";

  const health = await request.get(`${apiBase}/api/health`);
  expect(health.ok()).toBeTruthy();
  expect(await health.json()).toMatchObject({
    ok: true,
    service: "trust-dependency-mapper"
  });

  const ready = await request.get(`${apiBase}/api/health/ready`);
  expect(ready.ok()).toBeTruthy();
  expect(await ready.json()).toMatchObject({
    ok: true,
    checks: { database: "ok" }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /know what your protocol trusts/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Analyze" })).toBeVisible();
});
