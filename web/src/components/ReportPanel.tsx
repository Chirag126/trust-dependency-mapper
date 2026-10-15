import React, { useEffect, useState } from "react";
import { Download, FileText, Printer, RefreshCw, AlertTriangle } from "lucide-react";
import { api } from "../api";
import type { Analysis } from "../types";

type Report = {
  generatedAt: string;
  source: { analysisId: string; inputLabel: string; status: string; network?: string; inputType: string };
  executiveSummary: string;
  riskOverview: { critical: number; high: number; medium: number; low: number; info: number; dependencyCount: number; privilegedControls: number; upgradeable: boolean };
  findings: Array<{ id: string; severity: string; title: string; description: string; confidence: number; evidence: Array<{ source: string; reason: string; file?: string; line?: number; function?: string; value?: string }>; remediation: string }>;
  trustOverview: Array<{ name: string; type: string; severity: string; confidence: number; capabilities: string[]; evidence: unknown[] }>;
  scenarios: string[];
  limitations: string[];
  reportMode: string;
  fallbackReason?: string;
};

const severityClass = (severity: string) => severity === "critical" ? "sev-critical" : severity === "high" ? "sev-high" : severity === "medium" ? "sev-medium" : "sev-low";

export default function ReportPanel({ analysis }: { analysis: Analysis | null }) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate(useAi = false) {
    if (!analysis) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<Report>("/api/analyses/" + encodeURIComponent(analysis.id) + (useAi ? "/report/ai" : "/report"));
      setReport(result);
    } catch (e: any) {
      setError(e?.message || "Could not generate the report.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { setReport(null); setError(""); }, [analysis?.id]);

  async function exportSarif() {\n    if (!analysis) return;\n    try {\n      const sarif = await api<any>("/api/analyses/" + encodeURIComponent(analysis.id) + "/report.sarif");\n      const blob = new Blob([JSON.stringify(sarif, null, 2)], { type: "application/sarif+json" });\n      const url = URL.createObjectURL(blob);\n      const link = document.createElement("a");\n      link.href = url;\n      link.download = "tdm-" + analysis.id + ".sarif.json";\n      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);\n    } catch (e: any) { setError(e?.message || "Could not export SARIF."); }\n  }\n\n  function exportJson() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "tdm-security-report-" + report.source.analysisId + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  if (!analysis) return <section className="report-page"><div className="section-head"><div><div className="eyebrow">SECURITY REPORT</div><h2>Generate a security report</h2><p>Run an analysis first, then return here to create its report.</p></div></div><div className="empty-state"><FileText size={32}/><h3>No analysis selected</h3><p>The report is grounded in an existing analysis and its evidence.</p></div></section>;

  return <section className="report-page">
    <div className="section-head"><div><div className="eyebrow">SECURITY REPORT</div><h2>{analysis.inputLabel}</h2><p>Evidence-backed report from the analysis engine. Status: {analysis.status}.</p></div>
      <div className="actions"><button onClick={exportJson} disabled={!report}><Download size={15}/> Export JSON</button><button onClick={exportSarif}><Download size={15}/> Export SARIF</button><button onClick={() => window.print()} disabled={!report}><Printer size={15}/> Print / Save PDF</button></div>
    </div>
    <div className="report-toolbar"><span>Report is generated from stored analysis data; no AI-generated claims are added in this version.</span><div className="report-buttons"><button className="primary" onClick={() => generate(false)} disabled={busy}>{busy ? <><RefreshCw className="spin" size={16}/>Generating…</> : <><FileText size={16}/>Generate standard report</>}</button><button className="primary secondary-report" onClick={() => generate(true)} disabled={busy}>{busy ? "Working…" : "Generate AI-enhanced report"}</button></div></div>
    {error && <div className="error page-error"><AlertTriangle size={16}/>{error}<button onClick={() => generate(false)}>Retry</button></div>}
    {report && <>
      <div className="report-meta"><span>Generated: {new Date(report.generatedAt).toLocaleString()}</span><span>Mode: {report.reportMode}</span><span>Input: {report.source.inputType}</span></div>{report.fallbackReason && <div className="report-fallback">{report.fallbackReason}</div>}
      <div className="panel report-block"><div className="panel-title">Executive summary</div><p>{report.executiveSummary}</p><div className="report-stats">
        <ReportStat value={report.riskOverview.critical} label="Critical"/><ReportStat value={report.riskOverview.high} label="High"/><ReportStat value={report.riskOverview.medium} label="Medium"/><ReportStat value={report.riskOverview.low} label="Low"/><ReportStat value={report.riskOverview.dependencyCount} label="Dependencies"/>
      </div></div>
      <div className="panel report-block"><div className="panel-title">Important findings <small>{report.findings.length}</small></div>
        {report.findings.length ? report.findings.map(f => <article className="report-finding" key={f.id}>
          <div className="report-finding-head"><span className={severityClass(f.severity)}>{f.severity}</span><b>{f.title}</b><span>{Math.round(f.confidence * 100)}% confidence</span></div>
          <p>{f.description}</p><h4>Evidence</h4>
          {f.evidence.length ? f.evidence.map((ev, i) => <div className="report-evidence" key={i}><b>{ev.source}</b><span>{ev.reason}</span>{ev.file && <code>{ev.file}{ev.line ? ":" + ev.line : ""}</code>}{ev.function && <code>{ev.function}</code>}{ev.value && <code>{ev.value}</code>}</div>) : <p>No evidence was attached. Treat this finding as unverified until reviewed.</p>}
          <h4>Suggested remediation</h4><p>{f.remediation}</p>
        </article>) : <p className="report-paragraph">No heuristic findings were produced from the available evidence. This does not prove the contract is secure.</p>}
      </div>
      <div className="panel report-block"><div className="panel-title">Trust and dependency overview <small>{report.trustOverview.length}</small></div>
        {report.trustOverview.length ? report.trustOverview.map((d, i) => <div className="trust-row" key={d.name + "-" + i}><div><b>{d.name}</b><span>{d.type} · {Math.round(d.confidence * 100)}% confidence</span></div><span className={severityClass(d.severity)}>{d.severity}</span><p>{d.capabilities.join(", ") || "No capabilities recorded"} · {d.evidence.length} evidence item(s)</p></div>) : <p className="report-paragraph">No dependencies were recorded.</p>}
      </div>
      <div className="panel report-block"><div className="panel-title">Potential attack and failure scenarios</div>{report.scenarios.length ? report.scenarios.map((s, i) => <p className="report-paragraph" key={i}>{i + 1}. {s}</p>) : <p className="report-paragraph">No scenarios were generated. This does not establish that attack paths are absent.</p>}</div>
      <div className="panel report-block"><div className="panel-title">Known limitations and unperformed checks</div><ul className="report-limitations">{report.limitations.map((s, i) => <li key={i}>{s}</li>)}</ul><p className="report-disclaimer">This report summarizes automated analysis output. Validate findings in context before making security decisions.</p></div>
    </>}
  </section>;
}

function ReportStat({ value, label }: { value: number; label: string }) {
  return <div className="stat"><strong>{value}</strong><span>{label}</span></div>;
}
