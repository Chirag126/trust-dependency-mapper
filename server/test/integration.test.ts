import test from "node:test";
import assert from "node:assert/strict";
import { spawn, ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";

const serverRoot = process.cwd();
let child: ChildProcess | undefined;
let base = "";
let tempDir = "";
let sessionA = "integration-browser-session-a";
let sessionB = "integration-browser-session-b";
const password = "integration-password-123";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate test port");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function waitForApi(url: string, process: ChildProcess) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`API process exited with code ${process.exitCode}`);
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error("API did not become healthy within 20 seconds");
}
function zipFixture() {
  const zip = new AdmZip();
  zip.addFile("contracts/Vault.sol", Buffer.from(`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract OracleLike { function latestAnswer() external pure returns (int256) { return 42; } }
contract Vault {
 address public owner;
 address public oracle;
 address public implementation;
 constructor(address oracle_) { owner = msg.sender; oracle = oracle_; }
 function setOracle(address next) external { require(msg.sender == owner, "owner only"); oracle = next; }
 function withdraw(address target) external { (bool ok,) = target.call(""); require(ok, "call failed"); }
}`));
  return zip.toBuffer();
}
async function request(route: string, options: RequestInit = {}, session = sessionA, access?: string, organizationId?: string) {
  const headers = new Headers(options.headers);
  headers.set("x-anonymous-session", session);
  if (options.body && !(options.body instanceof FormData)) headers.set("content-type", "application/json");
  if (access) headers.set("authorization", `Bearer ${access}`);
  if (organizationId) headers.set("x-organization-id", organizationId);
  return fetch(`${base}${route}`, { ...options, headers });
}
async function json(response: Response) { return response.json() as Promise<any>; }

test("API integration: accounts, workspace isolation, analysis, reports, watchlist, compare and invalid inputs", async t => {
  tempDir = await mkdtemp(path.join(tmpdir(), "tdm-api-integration-"));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: serverRoot,
    env: { ...process.env, NODE_ENV: "test", PORT: String(port), DATABASE_PATH: path.join(tempDir, "integration.sqlite"), CORS_ORIGIN: "http://127.0.0.1:4173", ADMIN_JWT_SECRET: "integration-test-secret-that-is-long-enough-123456", ADMIN_PASSWORD: "integration-admin-password" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  child.stdout?.on("data", chunk => logs += String(chunk));
  child.stderr?.on("data", chunk => logs += String(chunk));
  t.after(async () => {
    child?.kill("SIGTERM");
    await new Promise(resolve => setTimeout(resolve, 250));
    await rm(tempDir, { recursive: true, force: true });
    if (child?.exitCode && child.exitCode !== 0) assert.fail(`API process failed: ${logs}`);
  });
  await waitForApi(`${base}/api/health`, child);

  const unauthenticated = await request("/api/organizations");
  assert.equal(unauthenticated.status, 401, "organization endpoints require authentication");

  const registered = await request("/api/accounts/register", { method: "POST", body: JSON.stringify({ email: "owner@example.test", password }) });
  assert.equal(registered.status, 201);
  const login = await request("/api/accounts/login", { method: "POST", body: JSON.stringify({ email: "owner@example.test", password }) });
  assert.equal(login.status, 200);
  const owner = await json(login);
  assert.ok(owner.access && owner.refresh);

  const orgResponse = await request("/api/organizations", { method: "POST", body: JSON.stringify({ name: "Integration workspace" }) }, sessionA, owner.access);
  assert.equal(orgResponse.status, 201);
  const org = await json(orgResponse);
  assert.ok(org.id);

  const secondRegistration = await request("/api/accounts/register", { method: "POST", body: JSON.stringify({ email: "member@example.test", password }) }, sessionB);
  assert.equal(secondRegistration.status, 201);
  const secondLogin = await request("/api/accounts/login", { method: "POST", body: JSON.stringify({ email: "member@example.test", password }) }, sessionB);
  const member = await json(secondLogin);
  const addMember = await request("/api/organizations/members", { method: "POST", body: JSON.stringify({ email: "member@example.test", role: "member" }) }, sessionA, owner.access, org.id);
  assert.equal(addMember.status, 201);
  const memberList = await request("/api/organizations/members", {}, sessionB, member.access, org.id);
  assert.equal(memberList.status, 200);
  assert.equal((await json(memberList)).length, 2);

  const invalidAddress = await request("/api/analyze/address", { method: "POST", body: JSON.stringify({ address: "not-an-address", network: "ethereum" }) });
  assert.ok(invalidAddress.status === 400 || invalidAddress.status === 503, "invalid address should fail safely");
  const unavailableRpc = await request("/api/analyze/address", { method: "POST", body: JSON.stringify({ address: "0x0000000000000000000000000000000000000001", network: "ethereum" }) });
  assert.ok([200, 400, 503].includes(unavailableRpc.status), "unconfigured RPC must return a handled response");
  if (unavailableRpc.status === 503) assert.doesNotMatch(await unavailableRpc.text(), /stack|node_modules|C:\\\\|\/home\//i);

  const invalidGithub = await request("/api/analyze/github", { method: "POST", body: JSON.stringify({ url: "not a URL" }) });
  assert.equal(invalidGithub.status, 400);
  const zip = zipFixture();
  const form = new FormData();
  form.append("project", new Blob([zip], { type: "application/zip" }), "vault.zip");
  const zipAnalysisResponse = await request("/api/analyze/zip", { method: "POST", body: form });
  assert.equal(zipAnalysisResponse.status, 200);
  const analysis = await json(zipAnalysisResponse);
  assert.ok(analysis.id && Array.isArray(analysis.nodes) && Array.isArray(analysis.edges) && Array.isArray(analysis.findings));
  assert.ok(Array.isArray(analysis.dependencies));

  const reportResponse = await request(`/api/analyses/${analysis.id}/report`);
  assert.equal(reportResponse.status, 200);
  assert.ok((await json(reportResponse)).schemaVersion);
  const sarifResponse = await request(`/api/analyses/${analysis.id}/report.sarif`);
  assert.equal(sarifResponse.status, 200);
  assert.match(sarifResponse.headers.get("content-type") || "", /sarif/);
  assert.ok((await json(sarifResponse)).runs);

  const watchResponse = await request("/api/watchlist", { method: "POST", body: JSON.stringify({ name: "Integration vault", analysisId: analysis.id }) });
  assert.ok([200, 201].includes(watchResponse.status));
  const watch = await json(watchResponse);
  const watches = await json(await request("/api/watchlist"));
  assert.ok(watches.some((item: any) => Number(item.id) === Number(watch.id)));
  const hiddenWatch = await request(`/api/watchlist/${watch.id}/status`, {}, sessionB);
  assert.ok([403, 404].includes(hiddenWatch.status), "another browser session must not read watch status");

  const secondZipForm = new FormData();
  secondZipForm.append("project", new Blob([zip], { type: "application/zip" }), "vault-again.zip");
  const secondAnalysisResponse = await request("/api/analyze/zip", { method: "POST", body: secondZipForm });
  assert.equal(secondAnalysisResponse.status, 200);
  const secondAnalysis = await json(secondAnalysisResponse);
  const comparison = await request("/api/compare", { method: "POST", body: JSON.stringify({ beforeId: analysis.id, afterId: secondAnalysis.id }) });
  assert.equal(comparison.status, 200);
  const crossSessionAnalysis = await request(`/api/analyses/${analysis.id}`, {}, sessionB);
  assert.equal(crossSessionAnalysis.status, 404);

  const malformedZip = await request("/api/analyze/zip", { method: "POST", body: (() => { const f = new FormData(); f.append("project", new Blob(["not a zip"], { type: "application/zip" }), "bad.zip"); return f; })() });
  assert.ok([400, 500].includes(malformedZip.status));
  assert.doesNotMatch(await malformedZip.text(), /stack trace|node_modules|C:\\\\Users/i);

  const rotated = await request("/api/accounts/refresh", { method: "POST", body: JSON.stringify({ refresh: owner.refresh }) });
  assert.equal(rotated.status, 200);
  const rotatedOwner = await json(rotated);
  const replay = await request("/api/accounts/refresh", { method: "POST", body: JSON.stringify({ refresh: owner.refresh }) });
  assert.equal(replay.status, 401, "refresh-token replay must be rejected");
  const logout = await request("/api/accounts/logout", { method: "POST", body: JSON.stringify({ refresh: rotatedOwner.refresh }) });
  assert.equal(logout.status, 200);
  const afterLogout = await request("/api/organizations", {}, sessionA, rotatedOwner.access);
  assert.equal(afterLogout.status, 401);
});
