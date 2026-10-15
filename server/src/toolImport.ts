import type { Analysis, Evidence, Severity } from "./types";

type ExternalFinding = { id?: string; check?: string; impact?: string; confidence?: string; description?: string; markdown?: string; elements?: Array<{ type?: string; name?: string; source_mapping?: { filename_relative?: string; filename_absolute?: string; lines?: number[]; starting_column?: number; ending_column?: number } }> };

function severity(value: unknown): Severity {
  const v = String(value || "").toLowerCase();
  if (v === "critical" || v === "high" || v === "medium" || v === "low" || v === "info") return v;
  if (v === "high impact") return "high";
  if (v === "medium impact") return "medium";
  if (v === "low impact") return "low";
  return "info";
}
function confidence(value: unknown): number {
  const v = String(value || "").toLowerCase();
  if (v === "high") return 0.9;
  if (v === "medium") return 0.65;
  if (v === "low") return 0.4;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
}
function normalizeSlitherFinding(raw: ExternalFinding, index: number) {
  const title = String(raw.check || raw.id || `Slither finding ${index + 1}`).slice(0, 300);
  const elements = Array.isArray(raw.elements) ? raw.elements : [];
  const evidence: Evidence[] = elements.map(el => {
    const sm = el.source_mapping || {};
    return {
      source: "source" as const,
      ...(sm.filename_relative || sm.filename_absolute ? { file: String(sm.filename_relative || sm.filename_absolute).replace(/\\/g, "/").slice(0, 500) } : {}),
      ...(Array.isArray(sm.lines) && Number.isInteger(sm.lines[0]) && sm.lines[0] > 0 ? { line: sm.lines[0] } : {}),
      ...(el.name ? { function: String(el.name).slice(0, 300) } : {}),
      reason: `Imported from Slither: ${title}`,
      ...(el.type ? { value: String(el.type).slice(0, 100) } : {})
    };
  });
  return {
    id: `slither:${String(raw.id || raw.check || index + 1).replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 180)}`,
    severity: severity(raw.impact),
    title: `Slither: ${title}`,
    description: String(raw.markdown || raw.description || title).slice(0, 10000),
    confidence: confidence(raw.confidence),
    evidence
  };
}

/** Merge Slither JSON detector output into an existing TDM analysis without discarding native findings. */
export function mergeSlitherJson(a: Analysis, input: unknown): Analysis {
  if (!input || typeof input !== "object") throw new Error("Expected a Slither JSON object");
  const root = input as { results?: { detectors?: unknown } };
  if (!root.results || !Array.isArray(root.results.detectors)) {
    throw new Error("Unsupported Slither JSON: expected results.detectors array");
  }
  const imported = root.results.detectors.map((item, i) => normalizeSlitherFinding((item && typeof item === "object" ? item : {}) as ExternalFinding, i));
  const byId = new Map((a.findings || []).map(f => [f.id, f]));
  for (const f of imported) byId.set(f.id, f);
  const findings = [...byId.values()];
  const count = (s: Severity) => findings.filter(f => f.severity === s).length;
  return {
    ...a,
    findings,
    summary: {
      ...a.summary,
      critical: count("critical"),
      high: count("high"),
      medium: count("medium"),
      low: count("low")
    },
    metadata: { ...a.metadata, importedTools: [...new Set([...(Array.isArray(a.metadata.importedTools) ? a.metadata.importedTools as string[] : []), "slither"])], slitherImportedFindingCount: imported.length }
  };
}
