export type InputType = "address" | "github" | "zip";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type DependencyType =
  | "admin"
  | "owner"
  | "multisig"
  | "proxy"
  | "implementation"
  | "oracle"
  | "token"
  | "bridge"
  | "external-contract"
  | "trusted-signer"
  | "unknown";

export interface Evidence {
  file?: string;
  line?: number;
  function?: string;
  selector?: string;
  reason: string;
  source: "source" | "abi" | "bytecode" | "storage" | "rpc";
  value?: string;
}

export interface Dependency {
  id: string;
  address?: string;
  name: string;
  type: DependencyType;
  severity: Severity;
  confidence: number;
  capabilities: string[];
  evidence: Evidence[];
}

export interface GraphNode {
  id: string;
  label: string;
  kind: "root" | "dependency" | "component";
  dependencyId?: string;
  severity?: Severity;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  evidence?: Evidence[];
}

export interface Analysis {
  id: string;
  inputType: InputType;
  inputLabel: string;
  network?: string;
  root: { address?: string; name: string };
  createdAt: string;
  durationMs: number;
  status: "completed" | "failed";
  summary: {
    dependencyCount: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    privilegedControls: number;
    upgradeable: boolean;
  };
  dependencies: Dependency[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  findings: {
    id: string;
    severity: Severity;
    title: string;
    description: string;
    evidence: Evidence[];
    confidence: number;
  }[];
  logs: { ts: string; level: "info" | "success" | "warn" | "error"; message: string }[];
  metadata: Record<string, unknown>;
}
