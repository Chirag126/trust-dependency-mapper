
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { analyzeFiles } from "./analyzer";
import { createUser, createOrganization, getMembership, addMember, orgUsage, reserveOrgAnalysis, saveBillingEvent, saveAnalysis, getAnalysisForUser, getAnalysis } from "./db";
import { withRetry } from "./chain";
import { buildSarif } from "./sarif";
import { mergeSlitherJson } from "./toolImport";

async function main() {
  // Organization isolation, role membership, quota enforcement, and webhook idempotency.
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const owner = createUser(`owner-${suffix}@example.test`, "owner-password-123");
  const member = createUser(`member-${suffix}@example.test`, "member-password-123");
  const outsider = createUser(`outsider-${suffix}@example.test`, "outsider-password-123");
  const org = createOrganization(owner.id, `TDM Test ${suffix}`);
  assert.equal(getMembership(org.id, owner.id)?.role, "owner", "creator should become organization owner");
  assert.equal(getMembership(org.id, outsider.id), undefined, "uninvited user must not access another organization");
  addMember(org.id, member.email, "member");
  assert.equal(getMembership(org.id, member.id)?.role, "member", "member role should persist");
  const orgAnalysis:any={id:`org-analysis-${suffix}`,createdAt:new Date().toISOString(),inputType:"github",inputLabel:"private-test",network:undefined,durationMs:1,status:"completed",summary:{dependencyCount:0,critical:0,high:0,medium:0,low:0,privilegedControls:0,upgradeable:false},dependencies:[],nodes:[],edges:[],findings:[],logs:[],metadata:{}};
  saveAnalysis(orgAnalysis,"selftest",org.id);
  assert.equal(getAnalysisForUser(orgAnalysis.id,outsider.id),null,"outsider must not read another organization's analysis/report");
  assert.equal(getAnalysisForUser(orgAnalysis.id,member.id)?.id,orgAnalysis.id,"organization member should read organization analysis");
  assert.equal(getAnalysis(orgAnalysis.id),null,"public analysis lookup must not expose organization-owned analyses");
  assert.equal(orgUsage(org.id).limit, 10, "free plan should have a 10-analysis monthly quota");
  for (let i = 0; i < 10; i++) reserveOrgAnalysis(org.id);
  assert.throws(() => reserveOrgAnalysis(org.id), /quota reached/i, "free organization quota must be enforced server-side");
  assert.equal(saveBillingEvent(`evt-${suffix}`, "test", "test.event", {}) , true, "first billing event should be recorded");
  assert.equal(saveBillingEvent(`evt-${suffix}`, "test", "test.event", {}) , false, "duplicate billing events should be idempotent");
  let attempts = 0;
  const retried = await withRetry(async () => { attempts++; if (attempts < 2) throw new Error("transient RPC failure"); return "ok"; }, { attempts: 3, baseDelayMs: 50, maxDelayMs: 50 });
  assert.equal(retried, "ok", "retry helper should return successful result");
  assert.equal(attempts, 2, "retry helper should retry transient failures exactly once");
  // Keep the existing combined regression test.
  const source = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
interface IOracle { function latestRoundData() external view returns(uint80,int256,uint256,uint256,uint80); }
contract Test {
 address public owner;
 address public oracle = 0x0000000000000000000000000000000000000001;
 constructor(){owner=msg.sender;}
 function quote() external view returns(int256){(,int256 p,,,) = IOracle(oracle).latestRoundData(); return p;}
 function upgradeTo(address x) external { require(msg.sender==owner); (bool ok,)=x.delegatecall(""); require(ok); }
}
`;

  const a = await analyzeFiles(
    [{ path: "Test.sol", content: source }],
    "self-test"
  );

  assert.ok(
    a.status === "completed" || a.status === "partial",
    "analysis should disclose complete or partial status"
  );
  assert.ok(a.dependencies.some(d => d.type === "oracle"), "oracle dependency missing");
  assert.ok(a.dependencies.some(d => d.type === "owner"), "owner dependency missing");
  assert.ok(a.dependencies.some(d => d.type === "proxy"), "upgrade dependency missing");
  assert.ok(a.summary.upgradeable, "upgradeable summary missing");
  assert.ok(a.findings.some(f => f.title.includes("Delegatecall")), "delegatecall finding missing");
  assert.ok(
    a.logs.some(l => l.level === "success" || l.level === "warn"),
    "completion/partial-status log missing"
  );
  assert.ok(
    typeof a.metadata.compilerAvailable === "boolean",
    "compiler availability should be explicit"
  );

  // Run analysis against each standalone Solidity fixture.
  const fixtures = [
    { file: "proxy.sol", label: "proxy" },
    { file: "oracle.sol", label: "oracle" },
    { file: "access-control.sol", label: "access-control" },
    { file: "external-calls.sol", label: "external-calls" }
  ];

  for (const fixture of fixtures) {
    const content = await readFile(
      resolve(process.cwd(), "fixtures", fixture.file),
      "utf8"
    );

    assert.ok(content.includes("pragma solidity"), `${fixture.file} is not Solidity`);

    const result = await analyzeFiles([{ path: fixture.file, content }], `fixture-${fixture.label}`);
    const sarif = buildSarif(result);
    assert.equal(sarif.version, "2.1.0", `${fixture.file}: SARIF output should use version 2.1.0`);
    assert.equal(sarif.runs[0].tool.driver.name, "Trust Dependency Mapper");
    assert.equal(sarif.runs[0].results.length, result.findings.length, `${fixture.file}: SARIF should preserve each finding`);
    const imported = mergeSlitherJson(result, { results: { detectors: [{
      check: "reentrancy-eth", impact: "High", confidence: "High", description: "Imported test finding",
      elements: [{ type: "function", name: "withdraw()", source_mapping: { filename_relative: fixture.file, lines: [7] } }]
    }] } });
    const normalized = imported.findings.find(f => f.id.startsWith("slither:reentrancy-eth"));
    assert.ok(normalized, "Slither finding should normalize into TDM finding model");
    assert.equal(normalized.severity, "high");
    assert.equal(normalized.evidence[0]?.file, fixture.file);
    assert.equal(normalized.evidence[0]?.line, 7);
    assert.throws(() => mergeSlitherJson(result, { invalid: true }), /Unsupported Slither JSON/);

    assert.ok(
      result.status === "completed" || result.status === "partial",
      `${fixture.file}: analysis should disclose complete or partial status`
    );

    assert.ok(
      typeof result.metadata.compilerAvailable === "boolean",
      `${fixture.file}: compiler availability should be explicit`
    );

    const nodeIds = new Set(result.nodes.map(node => node.id));
    assert.equal(nodeIds.size, result.nodes.length, `${fixture.file}: graph node IDs must be unique`);
    for (const edge of result.edges) {
      assert.ok(nodeIds.has(edge.source), `${fixture.file}: graph edge source must exist: ${edge.source}`);
      assert.ok(nodeIds.has(edge.target), `${fixture.file}: graph edge target must exist: ${edge.target}`);
    }
    const edgeKeys = result.edges.map(edge => JSON.stringify([
      edge.source, edge.target, edge.relation,
      (edge.evidence || []).map(e => JSON.stringify([
        e.source, e.file ?? "", e.line ?? null, e.function ?? "",
        e.selector ?? "", e.reason, e.value ?? ""
      ])).sort()
    ]));
    assert.equal(new Set(edgeKeys).size, edgeKeys.length, `${fixture.file}: duplicate graph edges should be collapsed`);
    for (const dependency of result.dependencies) {
      const evidenceKeys = dependency.evidence.map(e => JSON.stringify([
        e.source, e.file ?? "", e.line ?? null, e.function ?? "",
        e.selector ?? "", e.reason, e.value ?? ""
      ]));
      assert.equal(new Set(evidenceKeys).size, evidenceKeys.length, `${fixture.file}: duplicate evidence should be collapsed for ${dependency.name}`);
    }

    console.log(`Fixture analysis passed: ${fixture.file} (${result.status})`);
  }

  console.log("TDM self-test: PASS");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});