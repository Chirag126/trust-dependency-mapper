import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, "../../server");
const password = "playwright-test-password-123";

function solidityZip(): Buffer {
  const script = `const AdmZip=require("adm-zip");const z=new AdmZip();z.addFile("contracts/Vault.sol",Buffer.from("pragma solidity ^0.8.20; contract Oracle { function latestAnswer() external pure returns(int256){return 42;} } contract Vault { address public owner; address public oracle; constructor(address o){owner=msg.sender;oracle=o;} function setOracle(address o) external {require(msg.sender==owner);oracle=o;} }"));process.stdout.write(z.toBuffer().toString("base64"));`;
  const encoded = execFileSync(process.execPath, ["-e", script], { cwd: serverDir, encoding: "utf8" });
  return Buffer.from(encoded, "base64");
}

test("browser journey: account, workspace, Solidity ZIP, report exports, watch, compare and persistence", async ({ page, request }) => {
  const email = `e2e-${Date.now()}@example.test`;
  const memberEmail = `member-${Date.now()}@example.test`;
  const apiBase = "http://127.0.0.1:4400";

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /know what your protocol trusts/i })).toBeVisible();

  await page.getByRole("button", { name: "Organizations" }).click();

  // Registration itself is exercised in the API integration suite. Create the
  // account through the API here so this browser journey isolates the UI sign-in
  // flow and does not conflate two API calls behind the "Register & sign in" button.
  const registered = await request.post(`${apiBase}/api/accounts/register`, { data: { email, password } });
  expect(registered.status()).toBe(201);
  const second = await request.post(`${apiBase}/api/accounts/register`, { data: { email: memberEmail, password } });
  expect(second.status()).toBe(201);

  await page.getByPlaceholder("Email address").fill(email);
  await page.getByPlaceholder("Password (10+ characters)").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByPlaceholder("New organization name")).toBeVisible();

  await page.getByPlaceholder("New organization name").fill("Playwright security workspace");
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByText("Members & roles")).toBeVisible();
  await page.getByPlaceholder("Existing account email").fill(memberEmail);
  await page.getByRole("button", { name: "Add member" }).click();
  await expect(page.getByText(memberEmail)).toBeVisible();

  // Return to personal mode so these fixtures don't consume the organization's quota.
  await page.locator("select").filter({ has: page.locator("option[value=\"\"]") }).first().selectOption("");
  await page.getByRole("button", { name: "Analyze" }).click();
  await page.getByRole("button", { name: "Upload Solidity ZIP" }).click();
  await page.locator('input[type="file"][accept=".zip"]').setInputFiles({
    name: "vault-fixture.zip",
    mimeType: "application/zip",
    buffer: solidityZip()
  });
  await page.getByRole("button", { name: /Analyze trust surface/ }).click();
  await expect(page.getByText("ANALYSIS COMPLETE", { exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".graph-panel")).toBeVisible();
  await expect(page.locator(".graph-panel svg g.node").first()).toBeVisible();
  await expect(page.locator(".lower-grid")).toBeVisible();
  await page.locator(".graph-panel svg g.node").nth(1).click();
  await expect(page.getByText("Dependency detail")).toBeVisible();
  await expect(page.getByText("Blast radius")).toBeVisible();
  await expect(page.locator("aside").getByRole("button", { name: "Security report" })).toBeVisible();

  await page.getByRole("button", { name: "Watch", exact: true }).click();
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByText("Previous analyses")).toBeVisible();
  await expect(page.getByText(/vault-fixture.zip/i)).toBeVisible();

  await page.getByRole("button", { name: "Analyze" }).click();
  await page.getByRole("button", { name: "Upload Solidity ZIP" }).click();
  await page.locator('input[type="file"][accept=".zip"]').setInputFiles({
    name: "vault-fixture-second.zip",
    mimeType: "application/zip",
    buffer: solidityZip()
  });
  await page.getByRole("button", { name: /Analyze trust surface/ }).click();
  await expect(page.getByText("ANALYSIS COMPLETE", { exact: true })).toBeVisible({ timeout: 45_000 });

  await page.locator("aside").getByRole("button", { name: "Security report" }).click();
  await page.getByRole("button", { name: "Generate standard report" }).click();
  await expect(page.getByText("Executive summary")).toBeVisible();
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  expect((await jsonDownload).suggestedFilename()).toMatch(/\.json$/);
  const sarifDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SARIF" }).click();
  expect((await sarifDownload).suggestedFilename()).toMatch(/\.sarif\.json$/);
  await page.evaluate(() => { (window as any).__tdmPrintCalled = false; window.print = () => { (window as any).__tdmPrintCalled = true; }; });
  await page.getByRole("button", { name: "Print / Save PDF" }).click();
  expect(await page.evaluate(() => (window as any).__tdmPrintCalled)).toBe(true);

  await page.getByRole("button", { name: "Compare" }).click();
  await expect(page.getByText(/Compare two analyses|Trust diff/i).first()).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByText("Previous analyses")).toBeVisible();
  await expect(page.getByText(/vault-fixture/i).first()).toBeVisible();
});

test("browser validation: invalid GitHub input and malformed upload are handled visibly", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "GitHub repository" }).click();
  await page.getByPlaceholder("https://github.com/owner/repository").fill("not a repository URL");
  await page.getByRole("button", { name: /Analyze trust surface/ }).click();
  await expect(page.getByText(/valid GitHub repository URL/i)).toBeVisible();

  await page.getByRole("button", { name: "Upload Solidity ZIP" }).click();
  await page.locator('input[type="file"][accept=".zip"]').setInputFiles({
    name: "broken.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("not a zip archive")
  });
  await page.getByRole("button", { name: /Analyze trust surface/ }).click();
  await expect(page.locator(".error")).toBeVisible();
});
