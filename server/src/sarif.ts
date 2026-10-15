import type { Analysis, Evidence, Severity } from "./types";

const level: Record<Severity, string> = {
  critical: "error", high: "error", medium: "warning", low: "note", info: "note"
};

export function buildSarif(a: Analysis) {
  const rules = new Map<string, { id: string; name: string; shortDescription: { text: string }; defaultConfiguration: { level: string } }>();
  for (const f of a.findings || []) {
    rules.set(f.id, {
      id: f.id,
      name: f.title,
      shortDescription: { text: f.title },
      defaultConfiguration: { level: level[f.severity] || "warning" }
    });
  }
  const results = (a.findings || []).map(f => {
    const locations = (f.evidence || []).filter(e => e.file || e.line).map(e => ({
      physicalLocation: {
        ...(e.file ? { artifactLocation: { uri: e.file.replace(/\\\\/g, "/") } } : {}),
        ...(e.line ? { region: { startLine: e.line } } : {})
      },
      ...(e.function ? { logicalLocations: [{ name: e.function, kind: "function" }] } : {})
    }));
    return {
      ruleId: f.id,
      level: level[f.severity] || "warning",
      message: { text: f.description || f.title },
      ...(locations.length ? { locations } : {}),
      properties: {
        severity: f.severity,
        confidence: f.confidence,
        analysisId: a.id,
        evidence: (f.evidence || []).map((e: Evidence) => ({ source: e.source, file: e.file, line: e.line, function: e.function, selector: e.selector, reason: e.reason, value: e.value }))
      }
    };
  });
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: { driver: { name: "Trust Dependency Mapper", informationUri: "https://github.com/Chirag126/trust-dependency-mapper", rules: [...rules.values()] } },
      invocations: [{ executionSuccessful: a.status !== "failed", properties: { analysisId: a.id, status: a.status, inputType: a.inputType, inputLabel: a.inputLabel, network: a.network || null } }],
      results
    }]
  };
}
