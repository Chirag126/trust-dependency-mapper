import type { Analysis, Evidence, Severity } from "./types";

export interface SecurityReport {
  schemaVersion: 1;
  generatedAt: string;
  source: { analysisId: string; inputType: string; inputLabel: string; network?: string; status: string };
  executiveSummary: string;
  riskOverview: { critical: number; high: number; medium: number; low: number; info: number; dependencyCount: number; privilegedControls: number; upgradeable: boolean };
  findings: Array<{ id: string; severity: Severity; title: string; description: string; confidence: number; evidence: Evidence[]; remediation: string; }>;
  trustOverview: Array<{ name: string; type: string; severity: Severity; confidence: number; capabilities: string[]; evidence: Evidence[] }>;
  scenarios: string[];
  limitations: string[];
  reportMode: "deterministic" | "ai";
}

const severityRank: Record<Severity, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

function remediationFor(title: string, description: string): string {
  const text = `${title} ${description}`.toLowerCase();
  if (/delegatecall|implementation|proxy|upgrade/.test(text)) return "Review upgrade authorization and implementation changes; restrict upgrades to a documented governance or multisig process, and test storage-layout compatibility. Confirm the applicable control in source or on-chain evidence.";
  if (/owner|admin|privileg|access.control|role/.test(text)) return "Verify privileged roles, enforce least privilege, and test unauthorized callers against each privileged function. Prefer explicit role checks and a documented recovery process.";
  if (/oracle|price|feed|rounddata/.test(text)) return "Validate oracle freshness, answer bounds, decimals, and failure behavior; consider independent sources and a safe response to stale or invalid data.";
  if (/external call|low.level call|call\(|reentr/.test(text)) return "Check return values and state-update ordering for external calls. Add reentrancy protection where state and call flow require it, and test adversarial callbacks.";
  if (/bridge|cross.chain|messag|signer/.test(text)) return "Review message authentication, replay protection, signer thresholds, and source/destination domain validation. Test forged, duplicated, delayed, and out-of-order messages.";
  return "Review the cited evidence in context, add a targeted regression test for the behavior, and confirm the intended trust boundary before changing production code.";
}

function evidenceText(evidence: Evidence[]): string {
  return evidence.map(e => [e.file, e.line ? `line ${e.line}` : "", e.function, e.reason].filter(Boolean).join(": ")).filter(Boolean).join("; ");
}

export function buildSecurityReport(a: Analysis): SecurityReport {
  const findings = [...(a.findings || [])]
    .sort((x, y) => (severityRank[y.severity] || 0) - (severityRank[x.severity] || 0) || y.confidence - x.confidence)
    .map(f => ({
      id: f.id,
      severity: f.severity,
      title: f.title,
      description: f.description,
      confidence: f.confidence,
      evidence: Array.isArray(f.evidence) ? f.evidence : [],
      remediation: remediationFor(f.title, f.description)
    }));

  const deps = [...(a.dependencies || [])]
    .sort((x, y) => (severityRank[y.severity] || 0) - (severityRank[x.severity] || 0) || y.confidence - x.confidence);

  const riskOverview = {
    critical: a.summary?.critical || 0,
    high: a.summary?.high || 0,
    medium: a.summary?.medium || 0,
    low: a.summary?.low || 0,
    info: findings.filter(f => f.severity === "info").length,
    dependencyCount: a.summary?.dependencyCount ?? deps.length,
    privilegedControls: a.summary?.privilegedControls || 0,
    upgradeable: Boolean(a.summary?.upgradeable)
  };

  const executiveSummary = findings.length
    ? `The analysis of ${a.inputLabel} completed with status "${a.status}". The engine reported ${findings.length} finding(s): ${riskOverview.critical} critical, ${riskOverview.high} high, ${riskOverview.medium} medium, and ${riskOverview.low} low. It mapped ${riskOverview.dependencyCount} dependencies and ${riskOverview.privilegedControls} privileged control(s). These are engine-generated results, not an independent proof of exploitability.`
    : `The analysis of ${a.inputLabel} completed with status "${a.status}" and reported no heuristic findings from the evidence available to the engine. This does not prove the contract is secure. The engine mapped ${riskOverview.dependencyCount} dependencies and ${riskOverview.privilegedControls} privileged control(s).`;

  const limitations: string[] = [
    "Findings reflect only the analysis engine's available evidence and implemented checks; absence of findings is not proof of security.",
    "Potential attack scenarios are hypotheses to validate, not confirmed exploits.",
    `Analysis status is "${a.status}".`
  ];
  if (a.status !== "completed") limitations.push("The analysis was partial or failed; interpret missing dependencies and findings with additional caution.");
  if (a.metadata && typeof a.metadata === "object" && "compilerAvailable" in a.metadata && a.metadata.compilerAvailable === false) {
    limitations.push("The Solidity compiler was unavailable, so compiler-dependent checks may not have run.");
  }
  if (a.metadata && typeof a.metadata === "object" && "runtimeTrace" in a.metadata && !a.metadata.runtimeTrace) {
    limitations.push("Runtime tracing was not confirmed by the analysis metadata.");
  }

  const scenarios = findings.slice(0, 5).map(f =>
    `${f.title}: ${f.description} Scenario to validate: determine whether the cited behavior can be reached by an untrusted caller under the deployed configuration. Evidence: ${evidenceText(f.evidence) || "No evidence detail was attached to this finding."}`
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: { analysisId: a.id, inputType: a.inputType, inputLabel: a.inputLabel, network: a.network, status: a.status },
    executiveSummary,
    riskOverview,
    findings,
    trustOverview: deps.map(d => ({ name: d.name, type: d.type, severity: d.severity, confidence: d.confidence, capabilities: d.capabilities || [], evidence: d.evidence || [] })),
    scenarios,
    limitations,
    reportMode: "deterministic"
  };
}
